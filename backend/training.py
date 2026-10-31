import gzip
import json
import math
import os
import threading
from pathlib import Path
import chess
import numpy as np
import torch
from torch.utils.data import IterableDataset, DataLoader
from .storage import ROOT, db
from .encoding import ACTIONS, board_tensor, history_tensor, legal_ids
from .encoding import encode_move
from .network import MoveNetwork, masked_logits

TRAIN_LOCK = threading.Lock()
torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))

class GameDataset(IterableDataset):
    def __init__(self, player_id, split, history, max_game_id):
        self.player_id, self.split, self.history, self.max_game_id = player_id, split, history, max_game_id

    def __iter__(self):
        with db() as c:
            # Cursor streams paths; dataset snapshot excludes concurrently imported games.
            rows = c.execute('SELECT path FROM games WHERE player_id=? AND split=? AND id<=? ORDER BY id',
                             (self.player_id, self.split, self.max_game_id))
            for row in rows:
                with gzip.open(row['path'], 'rt', encoding='utf-8') as f:
                    examples = json.load(f)['examples']
                for fen, history, move in examples:
                    board = chess.Board(fen)
                    mask = np.zeros(ACTIONS, dtype=bool)
                    mask[legal_ids(board)] = True
                    yield (torch.from_numpy(board_tensor(board)), torch.from_numpy(history_tensor(history, self.history)),
                           torch.from_numpy(mask), encode_move(chess.Move.from_uci(move)))

def metrics_pass(model, loader, device, optimizer=None, temperature=1.0):
    model.train(optimizer is not None)
    count, loss_sum, brier_sum = 0, 0., 0.
    hits = {1: 0, 3: 0, 5: 0}
    bins = [[0, 0., 0.] for _ in range(10)]
    with torch.set_grad_enabled(optimizer is not None):
        for boards, histories, masks, targets in loader:
            boards, histories, masks, targets = [x.to(device) for x in (boards, histories, masks, targets)]
            logits = masked_logits(model(boards, histories) / temperature, masks)
            loss = torch.nn.functional.cross_entropy(logits, targets)
            if optimizer:
                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.)
                optimizer.step()
            probs = logits.detach().softmax(-1)
            n = len(targets)
            count += n
            loss_sum += loss.item() * n
            brier_sum += (probs.square().sum(1) - 2 * probs.gather(1, targets[:, None]).squeeze(1) + 1).sum().item()
            ranked = probs.topk(5, dim=1).indices
            for k in hits:
                hits[k] += (ranked[:, :k] == targets[:, None]).any(1).sum().item()
            confidence, predicted = probs.max(1)
            for p, correct in zip(confidence.tolist(), (predicted == targets).tolist()):
                bucket = bins[min(int(p * 10), 9)]
                bucket[0] += 1
                bucket[1] += p
                bucket[2] += correct
    if not count:
        raise ValueError('Conjunto sem posições. Importe mais partidas independentes.')
    calibration = [dict(count=n, confidence=p/n if n else 0, accuracy=a/n if n else 0) for n, p, a in bins]
    return dict(positions=count, loss=loss_sum/count, nll=loss_sum/count, brier=brier_sum/count,
                **{f'top{k}': v/count for k, v in hits.items()}, calibration=calibration,
                ece=sum(abs(p-a) for n, p, a in bins)/count)

def atomic_save(payload, path):
    temp = path.with_suffix('.tmp')
    torch.save(payload, temp)
    os.replace(temp, path)

def train(player_id, settings, report, should_pause):
    with TRAIN_LOCK:
        return _train(player_id, settings, report, should_pause)

def _train(player_id, settings, report, should_pause):
    torch.manual_seed(42)
    config = dict(width=settings['width'], blocks=settings['blocks'], history=settings['history'])
    device = 'cuda' if settings['device'] == 'cuda' and torch.cuda.is_available() else 'cpu'
    folder = ROOT / 'models' / player_id
    folder.mkdir(parents=True, exist_ok=True)
    resume_path = folder / 'resume.pt'
    with db() as c:
        snapshot = c.execute('SELECT MAX(id) FROM games WHERE player_id=?', (player_id,)).fetchone()[0]
        counts = {r['split']: r['n'] for r in c.execute('SELECT split,COUNT(*) n FROM games WHERE player_id=? GROUP BY split', (player_id,))}
        previous = c.execute('SELECT * FROM models WHERE player_id=? ORDER BY version DESC LIMIT 1', (player_id,)).fetchone()
    if any(not counts.get(s) for s in ('train', 'validation', 'test')):
        raise ValueError('São necessárias partidas nos três conjuntos (80/10/10 por hash). Importe mais partidas; consulte a distribuição no Training Lab.')
    model = MoveNetwork(**config).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=settings['lr'], weight_decay=.01)
    start, history, best = 0, [], math.inf
    if settings['resume']:
        if not resume_path.exists():
            raise ValueError('Nenhum checkpoint para continuar.')
        saved = torch.load(resume_path, map_location=device, weights_only=True)
        if saved['config'] != config:
            raise ValueError('Use a mesma arquitetura do checkpoint para continuar.')
        model.load_state_dict(saved['state'])
        optimizer.load_state_dict(saved['optimizer'])
        start, history, best, snapshot = saved['epoch'], saved['history'], saved['best'], saved['snapshot']
        torch.set_rng_state(saved['rng'].cpu())
    elif settings['incremental']:
        if previous is None:
            raise ValueError('Fine-tuning exige um modelo treinado.')
        saved = torch.load(previous['path'], map_location=device, weights_only=True)
        if saved['config'] != config:
            raise ValueError('Use a arquitetura do modelo anterior para fine-tuning.')
        model.load_state_dict(saved['state'])
        for group in optimizer.param_groups:
            group['lr'] = min(settings['lr'], 0.0001)
    loaders = {s: DataLoader(GameDataset(player_id, s, config['history'], snapshot), batch_size=settings['batch_size'])
               for s in ('train', 'validation', 'test')}
    # Separate run directory prevents a previous run's best from being accidentally promoted.
    run_id = settings['run_id']
    best_path = folder / ('best-' + run_id + '.pt')
    if settings['resume']:
        best_path = Path(saved['best_path'])
    for epoch in range(start, start + settings['epochs']):
        training = metrics_pass(model, loaders['train'], device, optimizer)
        validation = metrics_pass(model, loaders['validation'], device)
        history.append(dict(epoch=epoch+1, train=training, validation=validation))
        if validation['nll'] < best:
            best = validation['nll']
            atomic_save(dict(state=model.state_dict(), config=config), best_path)
        atomic_save(dict(state=model.state_dict(), optimizer=optimizer.state_dict(), config=config,
                         epoch=epoch+1, history=history, best=best, snapshot=snapshot, rng=torch.get_rng_state(),
                         best_path=str(best_path)), resume_path)
        report(dict(epoch=epoch+1, history=history, device=device, checkpoint=str(resume_path)))
        if should_pause():
            return 'paused'
    saved = torch.load(best_path, map_location=device, weights_only=True)
    model.load_state_dict(saved['state'])
    # Select temperature using validation ONLY, streaming batches instead of retaining logits.
    candidates = [(t, metrics_pass(model, loaders['validation'], device, temperature=t))
                  for t in (.5, .75, 1., 1.5, 2., 3.)]
    temperature, validation = min(candidates, key=lambda item: item[1]['nll'])
    test = metrics_pass(model, loaders['test'], device, temperature=temperature)
    metrics = dict(validation=validation, test=test, history=history, calibrated=True,
                   temperature=temperature, dataset_snapshot=snapshot, split_strategy='sha256-80-10-10-v1')
    with db() as c:
        totals = c.execute('SELECT COUNT(*),SUM(examples) FROM games WHERE player_id=? AND id<=? AND split=?', (player_id, snapshot, 'train')).fetchone()
        version = c.execute('SELECT COALESCE(MAX(version),0)+1 FROM models WHERE player_id=?', (player_id,)).fetchone()[0]
        published = folder / f'model-v{version}.pt'
        atomic_save(dict(state=model.state_dict(), config=config, temperature=temperature), published)
        c.execute('INSERT INTO models(player_id,version,path,metrics,config,games,positions) VALUES(?,?,?,?,?,?,?)',
                  (player_id, version, str(published), json.dumps(metrics), json.dumps(config), totals[0], totals[1]))
    report(dict(epoch=history[-1]['epoch'], history=history, device=device, metrics=metrics, version=version))
    return 'completed'

def predict(model_record, fen, history):
    board = chess.Board(fen)
    if not board.is_valid():
        raise ValueError('FEN inválida para uma partida de xadrez padrão.')
    legal = list(board.legal_moves)
    if not legal:
        return []
    saved = torch.load(model_record['path'], map_location='cpu', weights_only=True)
    model = MoveNetwork(**saved['config'])
    model.load_state_dict(saved['state'])
    model.eval()
    with torch.inference_mode():
        logits = model(torch.from_numpy(board_tensor(board))[None],
                       torch.from_numpy(history_tensor(history, saved['config']['history']))[None])[0]
        probabilities = (logits[[encode_move(m) for m in legal]] / saved.get('temperature', 1.)).softmax(0).tolist()
    return sorted([dict(uci=m.uci(), san=board.san(m), origin=chess.square_name(m.from_square),
                        target=chess.square_name(m.to_square), piece=board.piece_at(m.from_square).symbol(), probability=p)
                   for m, p in zip(legal, probabilities)], key=lambda m: -m['probability'])
