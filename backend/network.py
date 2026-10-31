import torch
from torch import nn
from .encoding import ACTIONS, PAD, CHANNELS

class Residual(nn.Module):
    def __init__(self, width):
        super().__init__()
        self.body = nn.Sequential(nn.Conv2d(width, width, 3, padding=1), nn.GroupNorm(4, width), nn.GELU(),
                                  nn.Conv2d(width, width, 3, padding=1), nn.GroupNorm(4, width))
    def forward(self, x):
        return torch.nn.functional.gelu(x + self.body(x))

class MoveNetwork(nn.Module):
    """Per-profile model is the identity conditioning strategy; no cross-profile mixing."""
    def __init__(self, width=32, blocks=2, history=16):
        super().__init__()
        self.config = dict(width=width, blocks=blocks, history=history)
        self.spatial = nn.Sequential(nn.Conv2d(CHANNELS, width, 3, padding=1), nn.GELU(),
                                     *[Residual(width) for _ in range(blocks)], nn.Flatten(),
                                     nn.Linear(width * 64, 128), nn.GELU())
        self.tokens = nn.Embedding(ACTIONS + 1, width)
        self.positions = nn.Parameter(torch.randn(1, history, width) * .02)
        self.temporal = nn.TransformerEncoder(nn.TransformerEncoderLayer(width, 4, width*2, dropout=.1,
                                                 batch_first=True), 1, enable_nested_tensor=False)
        self.head = nn.Sequential(nn.Linear(128+width, 128), nn.GELU(), nn.Linear(128, ACTIONS))

    def forward(self, board, history):
        mask = history == PAD
        mask[:, -1] = False
        temporal = self.temporal(self.tokens(history) + self.positions, src_key_padding_mask=mask)[:, -1]
        return self.head(torch.cat([self.spatial(board), temporal], dim=1))

def masked_logits(logits, legal):
    return logits.masked_fill(~legal, -1e9)
