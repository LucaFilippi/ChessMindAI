import gzip
import io
import json
import random
import time
import chess
import chess.pgn
import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient
from backend.encoding import ACTIONS, encode_move, decode_move, board_tensor, history_tensor, legal_ids
from backend.importer import import_stream, split_for
from backend.network import MoveNetwork, masked_logits
from backend.storage import db, ROOT
from backend.training import train, predict, GameDataset
from backend.main import app, TrainInput

PGN = '''[White "Tester"]
[Black "Opponent"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *
'''

def corpus(n=60):
    """Synthetic legal games ONLY for plumbing tests, never player data."""
    rng = random.Random(87)
    games = []
    for _ in range(n):
        board = chess.Board()
        game = chess.pgn.Game()
        game.headers['White'] = 'Tester'
        game.headers['Black'] = 'Opponent'
        node = game
        for _ in range(10):
            if board.is_game_over():
                break
            move = rng.choice(list(board.legal_moves))
            node = node.add_variation(move)
            board.push(move)
        games.append(str(game))
    return '\n\n'.join(games)

def test_all_actions_roundtrip():
    for i in range(ACTIONS):
        assert encode_move(decode_move(i)) == i

@pytest.mark.parametrize('fen', [chess.STARTING_FEN, '4k3/P7/8/8/8/8/7p/4K3 w - - 0 1',
                         'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2'])
def test_special_moves_mask_and_probabilities(fen):
    board = chess.Board(fen)
    ids = legal_ids(board)
    assert len(ids) == len(set(ids))
    assert {decode_move(i) for i in ids} == set(board.legal_moves)
    mask = torch.zeros(1, ACTIONS, dtype=torch.bool)
    mask[0, ids] = True
    p = masked_logits(torch.randn(1, ACTIONS), mask).softmax(-1)
    assert p.sum().item() == pytest.approx(1, abs=1e-6)
    assert p[~mask].sum() == 0
    assert board_tensor(board).shape == (21, 8, 8)

def test_import_identification_color_dedupe_and_reconstruction(player):
    result = import_stream(player, io.StringIO(PGN), 'both')
    assert result['imported'] == 1 and result['positions'] == 3
    duplicate = import_stream(player, io.StringIO(PGN.replace('[Result "*"]', '[Result "*"]\n[Site "Other"]')), 'both')
    assert duplicate['duplicates'] == 1
    assert import_stream(player, io.StringIO(PGN), 'black')['skipped'] == 1
    assert import_stream(player, io.StringIO(PGN.replace('White "Tester"','White "Other"')), 'both')['skipped'] == 1
    with db() as c:
        row = c.execute('SELECT * FROM games').fetchone()
    with gzip.open(row['path'], 'rt') as f:
        examples = json.load(f)['examples']
    board = chess.Board()
    board.push_san('e4'); board.push_san('e5')
    assert examples[1][0] == board.fen()
    assert examples[1][1] == ['e2e4', 'e7e5']
    assert examples[1][2] == 'g1f3'

def test_invalid_game_does_not_block_next(player):
    invalid = PGN.replace('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6', '1. e4 e5 2. Bh6')
    result = import_stream(player, io.StringIO(invalid+'\n'+PGN), 'both')
    assert result['errors'] == 1
    assert result['imported'] == 1

def test_pasted_pgn_and_black_identity():
    with TestClient(app) as client:
        profile = client.post('/api/players', json={'name':'Tester','color':'black'}).json()
        pgn = PGN.replace('White "Tester"', 'White "Opponent"').replace('Black "Opponent"', 'Black "tEsTeR"')
        response = client.post(f"/api/players/{profile['id']}/import", data={'pgn_text':pgn,'color':'both'})
        assert response.status_code == 202
        result = wait_job(client, response.json()['job_id'])['detail']
        assert result['imported'] == 1 and result['positions'] == 3
        assert client.post(f"/api/players/{profile['id']}/import", data={}).status_code == 422
        with db() as c:
            path = c.execute('SELECT path FROM games WHERE player_id=?', (profile['id'],)).fetchone()['path']
        with gzip.open(path, 'rt') as f:
            examples = json.load(f)['examples']
        assert examples[0][2] == 'e7e5'
        assert examples[0][1] == ['e2e4']

def test_reported_chess_com_game_and_skip_reasons(player):
    pgn = '''[White "SuperNovaga"]
[Black "hyp3rd4rk"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nf6 3. Bb5 c6 4. Bc4 d5 5. Bb3 Qd6 6. Nc3 Be7 7. Qe2 O-O 8. d3
h6 9. Qe3 Ng4 10. Qe2 dxe4 11. dxe4 Be6 12. Bxe6 fxe6 13. Qc4 Nd7 14. Bd2 Rad8
15. Na4 Nb6 16. b3 Qxd2+ 17. Kf1 Qf4 18. Qxe6+ Rf7 19. Qc4 Nxc4 20. bxc4 Qxe4
21. Nc5 Qxc2 22. Nxb7 Rd3 23. Re1 Bb4 24. Nd4 Rxd4 25. Rxe5 Rd1+ 26. Re1 Rxe1#
0-1'''
    with db() as c:
        c.execute('UPDATE players SET name=?,color=? WHERE id=?', ('hyp3rd4rk','black',player['id']))
    black = dict(player, name='hyp3rd4rk', color='black')
    good = import_stream(black, io.StringIO(pgn), 'both')
    assert good['imported'] == 1 and good['positions'] == 26 and not good['errors']
    wrong_color = import_stream(black, io.StringIO(pgn), 'white')
    assert wrong_color['skipped'] == 1 and 'cor não corresponde' in wrong_color['messages'][0]
    wrong_name = import_stream(dict(black, name='Outro'), io.StringIO(pgn), 'both')
    assert wrong_name['skipped'] == 1 and 'não aparece em White/Black' in wrong_name['messages'][0]

def test_context_changes_output_and_gradient():
    torch.manual_seed(9)
    model = MoveNetwork(width=16, blocks=1, history=8)
    board = torch.from_numpy(board_tensor(chess.Board()))[None].repeat(2,1,1,1)
    histories = torch.from_numpy(np.stack([history_tensor([],8),history_tensor(['g1f3','g8f6'],8)]))
    model.eval()
    logits = model(board, histories)
    assert torch.isfinite(logits).all()
    assert not torch.allclose(logits[0], logits[1])
    loss = logits.square().mean()
    loss.backward()
    assert model.temporal.layers[0].self_attn.in_proj_weight.grad.abs().sum() > 0

def test_train_pause_resume_incremental_and_inference(player):
    imported = import_stream(player, io.StringIO(corpus()), 'white')
    assert imported['imported'] == 60
    with db() as c:
        rows = list(c.execute('SELECT id,hash,split FROM games'))
    assert {r['split'] for r in rows} == {'train','validation','test'}
    assert all(r['split'] == split_for(r['hash']) for r in rows)
    options = dict(TrainInput(epochs=1,width=16,blocks=1,history=8).model_dump(),run_id='test')
    progress = []
    assert train(player['id'],options,progress.append,lambda:True) == 'paused'
    with db() as c:
        assert not c.execute('SELECT * FROM models').fetchone()
    options.update(resume=True)
    assert train(player['id'],options,progress.append,lambda:False) == 'completed'
    with db() as c:
        row = dict(c.execute('SELECT * FROM models').fetchone())
    metrics = json.loads(row['metrics'])
    assert metrics['test']['positions'] > 0
    assert all(np.isfinite(metrics['test'][m]) for m in ('loss','nll','brier','ece','top1','top3','top5'))
    moves = predict(row,chess.STARTING_FEN,[])
    assert len(moves) == 20
    assert sum(m['probability'] for m in moves) == pytest.approx(1,abs=1e-6)
    assert {m['uci'] for m in moves} == {m.uci() for m in chess.Board().legal_moves}
    assert predict(row,chess.STARTING_FEN,[]) == moves
    options.update(resume=False,incremental=True,run_id='incremental')
    assert train(player['id'],options,progress.append,lambda:False) == 'completed'
    with db() as c:
        assert c.execute('SELECT COUNT(*) FROM models').fetchone()[0] == 2
    assert sum(1 for _ in GameDataset(player['id'],'test',8,max(r['id'] for r in rows))) == metrics['test']['positions']

def wait_job(client, job_id):
    deadline = time.monotonic()+120
    while time.monotonic()<deadline:
        job = next(j for j in client.get('/api/jobs').json() if j['id']==job_id)
        if job['status'] in ('completed','failed'):
            assert job['status'] == 'completed', job
            return job
        time.sleep(.05)
    pytest.fail('Job exceeded 120 seconds')

def test_api_end_to_end():
    with TestClient(app) as client:
        assert client.post('/api/players',json={'name':'   '}).status_code==422
        player = client.post('/api/players',json={'name':'Tester','color':'white'}).json()
        route = '/api/players/'+player['id']
        assert client.post(route+'/predict',json={}).status_code == 409
        upload = client.post(route+'/import',files=[('files',('test.pgn',corpus(),'application/x-chess-pgn'))],data={'color':'white'})
        assert upload.status_code == 202
        wait_job(client,upload.json()['job_id'])
        training = client.post(route+'/train',json={'epochs':1,'width':16,'blocks':1,'history':8})
        assert training.status_code == 202
        wait_job(client,training.json()['job_id'])
        prediction = client.post(route+'/predict',json={})
        assert prediction.status_code==200, prediction.text
        data = prediction.json()
        assert len(data['moves']) == 20
        result = client.post(f"/api/predictions/{data['id']}/actual",json={'uci':'e2e4'})
        assert result.status_code == 200 and 1<=result.json()['rank']<=20
        black = chess.Board();black.push_uci('e2e4')
        assert client.post(route+'/predict',json={'fen':black.fen()}).status_code == 409
        assert client.post(route+'/predict',json={'fen':chess.STARTING_FEN,'initial_fen':chess.STARTING_FEN,'history':['e2e4']}).status_code==422
        assert client.post(route+'/predict',json={'fen':'not fen'}).status_code==422
        assert client.get(route+'/dna').json()['counts']['moves'] > 0
        assert client.delete(route).status_code==200
        assert client.get('/api/players').json()==[]
        assert client.post('/api/players',json={'name':'x'},headers={'Origin':'https://example.org'}).status_code==403
