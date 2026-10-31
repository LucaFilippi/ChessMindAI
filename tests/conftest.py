import os
import tempfile
from pathlib import Path

# Imported before the application; never touches the user's data directory.
_temp = tempfile.TemporaryDirectory(prefix='chessmind-tests-')
os.environ['CHESSMIND_DATA'] = _temp.name

import pytest
from backend.storage import db, init

@pytest.fixture(autouse=True)
def clean_database():
    init()
    with db() as c:
        c.execute('DELETE FROM players')
    yield

@pytest.fixture
def player():
    with db() as c:
        c.execute("INSERT INTO players(id,name,color) VALUES('test-player','Tester','white')")
    return dict(id='test-player', name='Tester', color='white')
