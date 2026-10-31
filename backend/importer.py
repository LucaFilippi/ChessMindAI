import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path
import chess
import chess.pgn
from .storage import ROOT, db

def split_for(digest):
    bucket = int(digest[:8], 16) % 100
    return 'train' if bucket < 80 else 'validation' if bucket < 90 else 'test'

def import_stream(player, handle, color, report=lambda x: None):
    """One game in memory. A malformed game never becomes training data."""
    counters = dict(processed=0, imported=0, positions=0, skipped=0, duplicates=0, errors=0, messages=[])
    folder = ROOT / 'datasets' / player['id']
    folder.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            game = chess.pgn.read_game(handle)
        except (ValueError, UnicodeError) as error:
            counters['errors'] += 1
            counters['messages'] = (counters['messages'] + [str(error)])[-20:]
            report(counters)
            continue
        if game is None:
            break
        counters['processed'] += 1
        try:
            if game.errors:
                raise ValueError('; '.join(map(str, game.errors)))
            if game.headers.get('Variant', 'Standard') not in ('Standard', 'Chess'):
                raise ValueError('Somente xadrez padrão é suportado.')
            selected = set()
            matched_name = False
            for side, header in [(chess.WHITE, 'White'), (chess.BLACK, 'Black')]:
                if player['name'].strip().casefold() != game.headers.get(header, '').strip().casefold():
                    continue
                matched_name = True
                allowed = 'white' if side else 'black'
                if color not in ('both', allowed) or player['color'] not in ('both', allowed):
                    continue
                selected.add(side)
            if not selected:
                counters['skipped'] += 1
                reason = (f"Partida {counters['processed']}: nome do perfil '{player['name']}' não aparece em White/Black "
                          f"({game.headers.get('White', '?')} / {game.headers.get('Black', '?')})." if not matched_name else
                          f"Partida {counters['processed']}: jogador encontrado, mas sua cor não corresponde aos filtros "
                          f"(perfil: {player['color']}; importação: {color}).")
                counters['messages'] = (counters['messages'] + [reason])[-20:]
                continue
            board = game.board()
            if not board.is_valid():
                raise ValueError('Posição inicial inválida.')
            initial = board.fen()
            moves, examples, history = [], [], []
            stats = Counter()
            opening = []
            for move in game.mainline_moves():
                if move not in board.legal_moves:
                    raise ValueError(f'Movimento ilegal: {move.uci()}')
                if len(opening) < 8:
                    opening.append(board.san(move))
                if board.turn in selected:
                    examples.append([board.fen(), list(history[-32:]), move.uci()])
                    side = 'white' if board.turn else 'black'
                    piece = chess.piece_symbol(board.piece_type_at(move.from_square))
                    phase = 'opening' if board.fullmove_number <= 10 else 'endgame' if len(board.piece_map()) <= 12 else 'middlegame'
                    stats['moves'] += 1
                    stats['captures'] += int(board.is_capture(move))
                    stats['castles'] += int(board.is_castling(move))
                    stats[f'piece:{piece}'] += 1
                    stats[f'phase:{phase}'] += 1
                    stats[f'color:{side}'] += 1
                    stats[f'{side}:captures'] += int(board.is_capture(move))
                    # Exchange proxy: selected capture immediately after an opponent capture.
                    stats['recaptures'] += int(board.is_capture(move) and bool(moves) and moves[-1][1])
                moves.append([move.uci(), board.is_capture(move)])
                history.append(move.uci())
                board.push(move)
            if not examples:
                counters['skipped'] += 1
                continue
            # Headers intentionally excluded: identical trajectories cannot leak across splits.
            digest = hashlib.sha256((initial + '|' + ' '.join(history)).encode()).hexdigest()
            with db() as c:
                if c.execute('SELECT 1 FROM games WHERE player_id=? AND hash=?', (player['id'], digest)).fetchone():
                    counters['duplicates'] += 1
                    continue
                path = folder / (digest + '.json.gz')
                payload = dict(initial=initial, moves=history, examples=examples, pgn=str(game))
                with gzip.open(path, 'wt', encoding='utf-8') as out:
                    json.dump(payload, out, separators=(',', ':'))
                stats['opening:' + ' '.join(opening)] += 1
                c.execute('INSERT INTO games(player_id,hash,date,headers,path,examples,split,stats) VALUES(?,?,?,?,?,?,?,?)',
                          (player['id'], digest, game.headers.get('Date'), json.dumps(dict(game.headers)),
                           str(path), len(examples), split_for(digest), json.dumps(stats)))
            counters['imported'] += 1
            counters['positions'] += len(examples)
        except Exception as error:
            counters['errors'] += 1
            counters['messages'] = (counters['messages'] + [f"Partida {counters['processed']}: {error}"])[-20:]
        finally:
            report(counters.copy())
    return counters
