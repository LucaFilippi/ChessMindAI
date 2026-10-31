import chess
import numpy as np

# Stable action vocabulary: ((from * 64) + to) * 5 + promotion.
# promotion = none, knight, bishop, rook, queen. PAD is not an action.
PROMOTIONS = [None, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]
ACTIONS = 64 * 64 * 5
PAD = ACTIONS
CHANNELS = 21

def encode_move(move):
    return (move.from_square * 64 + move.to_square) * 5 + PROMOTIONS.index(move.promotion)

def decode_move(action):
    squares, promotion = divmod(int(action), 5)
    origin, target = divmod(squares, 64)
    return chess.Move(origin, target, promotion=PROMOTIONS[promotion])

def legal_ids(board):
    return [encode_move(m) for m in board.legal_moves]

def board_tensor(board):
    planes = np.zeros((CHANNELS, 8, 8), dtype=np.float32)
    for square, piece in board.piece_map().items():
        planes[(0 if piece.color else 6) + piece.piece_type - 1, square // 8, square % 8] = 1
    planes[12] = float(board.turn)
    for i, (color, side) in enumerate([(True, True), (True, False), (False, True), (False, False)]):
        planes[13+i] = float(board.has_kingside_castling_rights(color) if side else board.has_queenside_castling_rights(color))
    if board.ep_square is not None:
        planes[17, board.ep_square // 8, board.ep_square % 8] = 1
    planes[18] = min(board.halfmove_clock / 100, 1)
    planes[19] = min(board.fullmove_number / 200, 1)
    planes[20] = len(board.piece_map()) / 32
    return planes

def history_tensor(history, length):
    sequence = [encode_move(chess.Move.from_uci(m)) for m in history[-length:]]
    # A start token (PAD) is deliberately visible to avoid all-masked attention.
    return np.asarray([PAD] * (length - len(sequence)) + sequence, dtype=np.int64)
