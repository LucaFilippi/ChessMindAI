import gzip
import io
import json
import shutil
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
import chess
import chess.pgn
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .storage import ROOT, db, init
from .importer import import_stream
from .training import train, predict

pool = ThreadPoolExecutor(max_workers=2)
active = set()
mutex = threading.Lock()
pause_events = {}

@asynccontextmanager
async def lifespan(app):
    init()
    yield

app = FastAPI(title='Chess Mind AI', version='0.1.0', lifespan=lifespan)

@app.middleware('http')
async def local_origin(request: Request, call_next):
    origin = request.headers.get('origin')
    if origin and origin not in ('http://127.0.0.1:8000', 'http://localhost:8000', 'http://127.0.0.1:5173', 'http://localhost:5173'):
        return JSONResponse({'detail': 'Origem não autorizada.'}, status_code=403)
    return await call_next(request)

class PlayerInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: Literal['white', 'black', 'both'] = 'both'

class TrainInput(BaseModel):
    epochs: int = Field(default=5, ge=1, le=1000)
    batch_size: int = Field(default=32, ge=1, le=256)
    width: Literal[16, 32, 64] = 32
    blocks: int = Field(default=2, ge=1, le=6)
    history: Literal[8, 16, 32] = 16
    lr: float = Field(default=.001, gt=0, le=.01)
    device: Literal['cpu', 'cuda'] = 'cpu'
    resume: bool = False
    incremental: bool = False

class PositionInput(BaseModel):
    fen: str = chess.STARTING_FEN
    initial_fen: str | None = None
    history: list[str] = Field(default_factory=list)

def player_or_404(player_id):
    with db() as c:
        row = c.execute('SELECT * FROM players WHERE id=?', (player_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Perfil não encontrado.')
    return dict(row)

def reserve(player_id):
    with mutex:
        if player_id in active:
            raise HTTPException(409, 'Há uma operação em andamento neste perfil.')
        active.add(player_id)

def release(player_id):
    with mutex:
        active.discard(player_id)

def new_job(player_id, kind):
    job_id = uuid.uuid4().hex
    with db() as c:
        c.execute('INSERT INTO jobs(id,player_id,kind,status,detail) VALUES(?,?,?,?,?)', (job_id, player_id, kind, 'queued', '{}'))
    return job_id

def update_job(job_id, status, detail=None):
    with db() as c:
        if detail is None:
            c.execute('UPDATE jobs SET status=? WHERE id=?', (status, job_id))
        else:
            c.execute('UPDATE jobs SET status=?,detail=? WHERE id=?', (status, json.dumps(detail), job_id))

def run_training(player_id, job_id, options):
    event = threading.Event()
    pause_events[job_id] = event
    try:
        update_job(job_id, 'running')
        status = train(player_id, dict(**options, run_id=job_id),
                       lambda detail: update_job(job_id, 'pausing' if event.is_set() else 'running', detail), event.is_set)
        update_job(job_id, status)
    except Exception as e:
        update_job(job_id, 'failed', {'error': str(e)})
    finally:
        pause_events.pop(job_id, None)
        release(player_id)

@app.get('/api/health')
def health():
    return dict(status='ok', cuda=torch.cuda.is_available(), storage=str(ROOT.resolve()), torch=torch.__version__)

@app.get('/api/players')
def players():
    with db() as c:
        result = []
        for row in c.execute('SELECT * FROM players ORDER BY created,id'):
            player = dict(row)
            totals = c.execute('SELECT COUNT(*),COALESCE(SUM(examples),0) FROM games WHERE player_id=?', (row['id'],)).fetchone()
            player.update(games=totals[0], positions=totals[1])
            model = c.execute('SELECT * FROM models WHERE player_id=? ORDER BY version DESC LIMIT 1', (row['id'],)).fetchone()
            player['model'] = dict(model) if model else None
            if model:
                player['model']['metrics'] = json.loads(model['metrics'])
                player['model']['config'] = json.loads(model['config'])
            player['splits'] = {r['split']: r['n'] for r in c.execute('SELECT split,COUNT(*) n FROM games WHERE player_id=? GROUP BY split', (row['id'],))}
            result.append(player)
    return result

@app.post('/api/players', status_code=201)
def create_player(value: PlayerInput):
    if not value.name.strip():
        raise HTTPException(422, 'Informe um nome.')
    player_id = uuid.uuid4().hex
    with db() as c:
        c.execute('INSERT INTO players(id,name,color) VALUES(?,?,?)', (player_id, value.name.strip(), value.color))
    return player_or_404(player_id)

@app.delete('/api/players/{player_id}')
def delete_player(player_id):
    player_or_404(player_id)
    reserve(player_id)
    try:
        with db() as c:
            c.execute('DELETE FROM players WHERE id=?', (player_id,))
        for parent in ('datasets', 'models'):
            path = ROOT / parent / player_id
            if path.exists():
                shutil.rmtree(path)
    finally:
        release(player_id)
    return {'deleted': True}

def import_files(player, job_id, paths, color, auto_train):
    totals = dict(processed=0, imported=0, positions=0, skipped=0, duplicates=0, errors=0, messages=[])
    def combine(detail):
        merged = {k: totals[k] + detail[k] for k in totals if k != 'messages'}
        merged['messages'] = (totals['messages'] + detail['messages'])[-20:]
        return merged
    try:
        update_job(job_id, 'running', totals)
        for path in paths:
            with open(path, encoding='utf-8-sig', errors='replace') as handle:
                detail = import_stream(player, handle, color,
                                       lambda d: update_job(job_id, 'running', combine(d)))
            totals = combine(detail)
        update_job(job_id, 'completed', totals)
        if auto_train and totals['imported']:
            training_job = new_job(player['id'], 'training')
            run_training(player['id'], training_job, TrainInput().model_dump())
    except Exception as e:
        update_job(job_id, 'failed', dict(**totals, error=str(e)))
    finally:
        for path in paths:
            Path(path).unlink(missing_ok=True)
        release(player['id'])

@app.post('/api/players/{player_id}/import', status_code=202)
async def upload(player_id: str, files: list[UploadFile] | None = File(None), pgn_text: str = Form(''),
                 color: Literal['white', 'black', 'both'] = Form('both'), auto_train: bool = Form(False)):
    player = player_or_404(player_id)
    if not files and not pgn_text.strip():
        raise HTTPException(422, 'Selecione um arquivo ou cole o PGN.')
    reserve(player_id)
    paths = []
    try:
        folder = ROOT / 'uploads'
        folder.mkdir(exist_ok=True)
        for file in files or []:
            path = folder / (uuid.uuid4().hex + '.pgn')
            paths.append(path)
            with path.open('wb') as output:
                while chunk := await file.read(1024 * 1024):
                    output.write(chunk)
            await file.close()
        if pgn_text.strip():
            path = folder / (uuid.uuid4().hex + '.pgn')
            paths.append(path)
            path.write_text(pgn_text, encoding='utf-8')
        job_id = new_job(player_id, 'import')
        pool.submit(import_files, player, job_id, paths, color, auto_train)
        return {'job_id': job_id}
    except Exception:
        for path in paths:
            path.unlink(missing_ok=True)
        release(player_id)
        raise

@app.post('/api/players/{player_id}/train', status_code=202)
def start_training(player_id: str, options: TrainInput):
    player_or_404(player_id)
    reserve(player_id)
    job_id = new_job(player_id, 'training')
    pool.submit(run_training, player_id, job_id, options.model_dump())
    return {'job_id': job_id}

@app.get('/api/jobs')
def jobs():
    with db() as c:
        return [dict(dict(r), detail=json.loads(r['detail'])) for r in c.execute('SELECT * FROM jobs ORDER BY created DESC,rowid DESC LIMIT 100')]

@app.post('/api/jobs/{job_id}/pause')
def pause(job_id: str):
    if job_id not in pause_events:
        raise HTTPException(409, 'Treinamento não está em execução.')
    pause_events[job_id].set()
    update_job(job_id, 'pausing')
    return {'message': 'Pausa solicitada. O checkpoint será salvo ao concluir a época atual.'}

@app.post('/api/players/{player_id}/predict')
def prediction(player_id: str, position: PositionInput):
    player = player_or_404(player_id)
    try:
        board = chess.Board(position.fen)
        if not board.is_valid():
            raise ValueError('FEN inválida.')
        if position.history:
            if not position.initial_fen:
                raise ValueError('Histórico exige initial_fen para validar a sequência.')
            replay = chess.Board(position.initial_fen)
            for uci in position.history:
                replay.push_uci(uci)
            if replay.fen() != board.fen():
                raise ValueError('Histórico não corresponde à posição informada.')
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if player['color'] not in ('both', 'white' if board.turn else 'black'):
        raise HTTPException(409, 'É a vez do adversário. Este perfil não analisa essa cor.')
    with db() as c:
        model = c.execute('SELECT * FROM models WHERE player_id=? ORDER BY version DESC LIMIT 1', (player_id,)).fetchone()
    if model is None:
        raise HTTPException(409, 'Este perfil ainda não tem um modelo treinado.')
    moves = predict(dict(model), position.fen, position.history)
    with db() as c:
        prediction_id = c.execute('INSERT INTO predictions(player_id,model_id,fen,history,moves) VALUES(?,?,?,?,?)',
                  (player_id, model['id'], position.fen, json.dumps(position.history), json.dumps(moves))).lastrowid
    return dict(id=prediction_id, moves=moves, version=model['version'], metrics=json.loads(model['metrics']),
                game_over=board.is_game_over(), turn='white' if board.turn else 'black')

class ActualInput(BaseModel):
    uci: str

@app.post('/api/predictions/{prediction_id}/actual')
def actual(prediction_id: int, value: ActualInput):
    with db() as c:
        row = c.execute('SELECT * FROM predictions WHERE id=?', (prediction_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Previsão não encontrada.')
        try:
            chess.Board(row['fen']).parse_uci(value.uci)
        except ValueError as e:
            raise HTTPException(422, 'Movimento real ilegal.') from e
        c.execute('UPDATE predictions SET actual=? WHERE id=?', (value.uci, prediction_id))
    moves = json.loads(row['moves'])
    rank = next((i+1 for i, m in enumerate(moves) if m['uci'] == value.uci), None)
    return dict(rank=rank, evaluation='interactive', note='Avaliação interativa; não representa resultado em teste independente.')

@app.get('/api/players/{player_id}/dna')
def dna(player_id: str):
    player_or_404(player_id)
    counts = {}
    with db() as c:
        for row in c.execute('SELECT stats FROM games WHERE player_id=?', (player_id,)):
            for key, value in json.loads(row['stats']).items():
                counts[key] = counts.get(key, 0) + value
    return dict(counts=counts, source='Estatísticas observadas nos PGNs; não são interpretações da rede neural.')

@app.get('/api/players/{player_id}/games')
def games(player_id: str, offset: int = 0):
    player_or_404(player_id)
    with db() as c:
        return [dict(dict(r), headers=json.loads(r['headers'])) for r in c.execute(
            'SELECT id,headers,date,examples,split FROM games WHERE player_id=? ORDER BY id LIMIT 50 OFFSET ?', (player_id, max(0, offset)))]

@app.get('/api/players/{player_id}/games/{game_id}')
def game_detail(player_id: str, game_id: int):
    with db() as c:
        row = c.execute('SELECT path,split FROM games WHERE player_id=? AND id=?', (player_id, game_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Partida não encontrada.')
    with gzip.open(row['path'], 'rt', encoding='utf-8') as f:
        game = json.load(f)
    return dict(initial=game['initial'], moves=game['moves'], split=row['split'])

dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
if dist.exists():
    app.mount('/', StaticFiles(directory=dist, html=True), name='frontend')
