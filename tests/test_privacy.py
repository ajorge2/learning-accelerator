import importlib, sys
from pathlib import Path
from fastapi.testclient import TestClient

def test_separate_browser_databases_and_no_shared_search(tmp_path,monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-not-a-real-key')
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
    import database
    monkeypatch.setattr(database,'DB_PATH',tmp_path/'legacy.sqlite')
    import api
    with TestClient(api.app) as client:
        a={'X-Learning-Session':'a'*64};b={'X-Learning-Session':'b'*64}
        assert client.get('/nodes').status_code==401
        created=client.post('/nodes',headers=a,json={'title':'PRIVATE_SENTINEL'});assert created.status_code==201
        node=created.json()['id']
        assert client.get('/nodes',headers=b).json()==[]
        assert client.get('/nodes/'+node,headers=b).status_code==404
        assert client.delete('/nodes/'+node,headers=b).status_code==404
        assert len(client.get('/nodes',headers=a).json())==1
        assert client.post('/algolia/sync',headers=a,json={'records':[]}).status_code==403
        assert client.get('/nodes',headers={**a,'Origin':'https://hostile.example'}).status_code==403
        assert client.get('/nodes',headers=a).headers['Cache-Control']=='no-store'
