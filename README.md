# Chess Mind AI

Aplicação local para aprender **qual movimento um jogador tende a escolher**, usando seus PGNs. Não é uma engine de melhor lance. Não usa Stockfish, APIs comerciais, probabilidades fictícias ou progresso de treinamento simulado.

Versão inicial funcional: React/TypeScript + FastAPI + SQLite + uma rede PyTorch real por perfil. A aplicação começa vazia: você fornece as partidas.

## Executar no Windows

Pré-requisitos: Python **3.11**, Node.js **22.12+** e npm. Abra PowerShell na pasta do projeto:

```powershell
.\Install.ps1
.\Start.ps1
```

Abra **http://127.0.0.1:8000**. O servidor fica restrito ao computador local. `Ctrl+C` encerra. Se a política do Windows bloquear scripts, execute os comandos equivalentes abaixo, sem alterar a política global:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

O download inicial do PyTorch ocupa centenas de MB. Depois da instalação, os fluxos principais funcionam sem internet. CPU é padrão; para CUDA, instale a distribuição compatível do PyTorch conforme a documentação oficial e selecione CUDA no Training Lab. GPU não é necessária.

## Primeiro fluxo

1. Em **Players**, crie um perfil e escolha a cor analisada.
2. Em **Import PGN**, selecione um ou vários arquivos e o nome do perfil é comparado automaticamente com `White`/`Black`. A comparação ignora maiúsculas e espaços nas pontas. Também é possível colar o PGN diretamente na tela. A cor escolhida deve ser compatível com a do perfil.
3. Acompanhe partidas processadas, importadas, duplicadas, ignoradas e erros. Cada partida é validada por inteiro antes de entrar no dataset.
4. Em **Training Lab**, verifique que há partidas em treino, validação **e** teste. Comece com 16 canais, 1 bloco, histórico 8, batch 32 e poucas épocas para verificar o hardware.
5. Inicie o treino. As curvas são atualizadas ao concluir cada época. Pausar salva o checkpoint ao fim da época atual; continuar executa a quantidade informada de épocas **adicionais**.
6. Em **Prediction Board**, mova peças, carregue uma FEN ou abra um PGN. As setas e o ranking são calculados pelo modelo treinado. No PGN, o lance futuro fica oculto até avançar.
7. Após importar partidas novas, use **Fine-tuning com replay**: os pesos anteriores são atualizados com todos os exemplos históricos de treino e taxa de aprendizado de no máximo 0,0001.

Um corpus minúsculo pode não conter partidas nos três conjuntos. A aplicação explica isso e solicita mais dados; não reutiliza teste como treino para fazer o fluxo parecer funcionar. O modelo só é publicado após treino, seleção na validação e avaliação no teste.

## O que está implementado

| Área | Comportamento |
|---|---|
| Dashboard | Contadores persistidos e histórico real de tarefas |
| Players | Criar/excluir perfis, cores, volumes, modelo, versão e métricas |
| Import PGN | Upload em blocos, leitura por partida, identidade, cor, legalidade, deduplicação, erros e treino opcional |
| Training Lab | CNN residual + Transformer, CPU/CUDA, arquitetura configurável, checkpoints, pausa/retomada, fine-tuning e curvas |
| Métricas | Top-1/3/5, Cross-Entropy/NLL, Brier multiclasse, ECE e diagrama de calibração |
| Calibração | Temperatura escolhida exclusivamente na validação, entre 0,5 / 0,75 / 1 / 1,5 / 2 / 3; teste é usado apenas para avaliação |
| Prediction Board | Arrastar/clicar, validação, promoção com escolha da peça, roque/en passant, xeque, histórico, FEN, PGN, inversão e setas |
| Probabilidades | Distribuição sobre **todos** os movimentos legais; Top 3/5/10/todos apenas muda a visualização |
| Contexto | Transformer recebe até 8/16/32 meios-lances anteriores, validados contra a FEN inicial |
| Player DNA | Aberturas observadas, peças, capturas, roques, recapturas, fases e cores com critérios explícitos |
| Comparação | Duas redes independentes distribuem probabilidades na mesma FEN |
| Settings | Opacidade persistida, informação de CPU/CUDA e localização dos dados |

### Limites desta primeira versão

- O núcleo e as oito telas são funcionais; isto **não significa que todos os requisitos avançados do prompt mestre estejam concluídos**.
- A importação não limita o número de partidas e mantém apenas uma partida em memória. Ainda não houve benchmark com milhões de partidas. A implementação usa um arquivo gzip por partida; em escala muito grande, migrar para shards binários com índice antes de alegar desempenho de produção.
- O dataset é selecionado por perfil inteiro e snapshot do maior ID de partida, com divisão estável por hash. Seleção manual de partidas, divisão cronológica, versões explícitas de datasets e reprocessamento via UI ficam para evolução. Partidas repetidas com a mesma trajetória são deduplicadas mesmo se os cabeçalhos mudarem; transposições e variantes de trajetórias semelhantes podem ocorrer em conjuntos distintos.
- A identidade é condicionada por **modelos separados por perfil**, e não por um embedding compartilhado. Nenhum dado de outros perfis entra automaticamente no modelo.
- O estado inclui peças, lado, roques, en passant, relógio de meio-lance, número do lance e material. Controle de tempo e relógios PGN ainda não entram na rede. Campos ausentes não são inventados.
- Adaptação contextual é automática. Aprendizado incremental é acionado no Training Lab após importar novos PGNs; os lances feitos no tabuleiro de análise **não são automaticamente tratados como decisões reais do jogador**.
- A comparação lado a lado cobre probabilidades. Comparação gráfica de DNA entre dois jogadores e interpretação de estilo pela rede ainda não estão disponíveis.
- A análise aceita posições FEN legais; um editor de tabuleiro vazio não está incluído.
- Métricas de treino aparecem por época, não por batch. A pausa pode demorar uma época em datasets grandes. Um treino global por vez evita disputa de CPU/GPU.
- Avaliações interativas de lance real são identificadas como `interactive`, nunca apresentadas como teste independente. Resultados de teste são os da avaliação offline por partidas separadas.
- A calibração reduz NLL na validação entre os candidatos disponíveis; não garante calibração nem boa previsão em jogadores/dados futuros. Métricas em fixtures sintéticas só demonstram funcionamento técnico.
- Os testes cobrem CPU. CUDA e grandes volumes precisam de validação no hardware/dados de destino.

## Estrutura e fluxo

```text
backend/
  main.py        API, tarefas em segundo plano, perfis e validação de requisições
  storage.py     SQLite: perfis, partidas, modelos, tarefas e previsões
  importer.py    PGN em streaming, seleção, deduplicação e exemplos
  encoding.py    Tensores e vocabulário estável/reversível de movimentos
  network.py     CNN residual + Transformer temporal + cabeça de movimentos
  training.py    Dataset iterável, treino, métricas, checkpoints e inferência
frontend/src/
  App.tsx        Navegação e painéis
  Board.tsx      Tabuleiro, histórico, PGN/FEN e integração de previsões
  Arrows.tsx     SVG de probabilidades, orientação e destaque
  api.ts         Contratos tipados e cliente da API
tests/           Testes isolados; nunca usam a pasta data do usuário
data/            Gerada na execução, ignorada pelo Git
Install.ps1      Dependências e build
Start.ps1        Servidor local e frontend compilado
Test.ps1         Backend, frontend e build
```

Fluxo: **PGN → legalidade e identidade → exemplos antes do lance → arquivos comprimidos + índice SQLite → split por partida → rede supervisionada → melhor NLL de validação → calibração na validação → teste → checkpoint versionado → inferência com máscara legal → setas/ranking**.

### Representação e ausência de vazamento

- Ação: `((origem * 64) + destino) * 5 + promoção`, com casas `a1=0 … h8=63` e promoção `[nenhuma, cavalo, bispo, torre, dama]`. São 20.480 ações. O token 20.480 é reservado ao padding temporal.
- CNN recebe 21 canais de 8×8. O histórico contém somente movimentos **anteriores** ao alvo, incluindo movimentos adversários.
- Cross-Entropy é aplicada após máscara de legalidade. Na inferência, softmax usa apenas os logits dos movimentos legais.
- Hash SHA-256 de FEN inicial + trajetória completa define o split: buckets 0–79 treino, 80–89 validação, 90–99 teste. Importações futuras mantêm a atribuição. A máscara, o histórico e o alvo são reconstruídos a partir do mesmo estado.
- Um snapshot do maior ID fixa os dados utilizados pelo treinamento. Fine-tuning mantém os splits e usa apenas o conjunto de treino para atualizar os pesos. O melhor checkpoint e a temperatura são escolhidos usando validação, nunca teste.
- Checkpoints usam substituição atômica e carregamento `weights_only=True`. Só checkpoints locais criados pela aplicação são carregados.

### Critérios de aceite

Fundação: perfil criado aparece após reiniciar; exclusão remove seus dados; API responde; tabuleiro permite lances legais e rejeita ilegais; sem modelo não existem probabilidades.

Fluxo integrado: criar perfil → importar PGN → treinar uma rede pequena → salvar/recarregar → obter distribuição legal com soma ≈1 → renderizar setas → registrar lance real. Os testes automatizados verificam a parte API/modelo e renderização das setas; a interface também foi conferida manualmente no navegador local.

## Integração da sua chamada de dados

A fonte externa ainda não foi definida. Há um contrato pronto, independente do provedor: entregue PGN ao endpoint de importação. Não coloque credenciais do provedor no frontend nem no repositório.

Swagger interativo: **http://127.0.0.1:8000/docs**. Exemplo Python:

```python
import httpx

base = 'http://127.0.0.1:8000/api'
with httpx.Client(timeout=600) as client:
    response = client.post(base + '/players', json={'name': 'Jogador X', 'color': 'white'})
    response.raise_for_status()
    player_id = response.json()['id']
    with open('partidas.pgn', 'rb') as pgn:
        response = client.post(
            f'{base}/players/{player_id}/import',
            files={'files': ('partidas.pgn', pgn, 'application/x-chess-pgn')},
            data={'color': 'white', 'auto_train': 'false'},
        )
    response.raise_for_status()
    print(response.json())  # job_id; acompanhe GET /api/jobs
```

Endpoints principais:

```text
GET/POST /api/players
DELETE   /api/players/{id}
POST     /api/players/{id}/import       multipart, files e/ou pgn_text, color, auto_train
POST     /api/players/{id}/train        JSON conforme TrainInput no OpenAPI
GET      /api/jobs
POST     /api/jobs/{id}/pause
POST     /api/players/{id}/predict      fen, initial_fen e history (UCI)
POST     /api/predictions/{id}/actual   uci
GET      /api/players/{id}/dna
GET      /api/players/{id}/games        páginas de 50, parâmetro offset
GET      /api/players/{id}/games/{game_id}
GET      /api/health
```

`predict` com histórico exige `initial_fen`; o servidor reaplica toda a sequência e verifica a posição final. Para uma FEN isolada, envie histórico vazio. Perfis brancos/pretos rejeitam previsões na vez do adversário.

## Desenvolvimento e testes

```powershell
.\Test.ps1
# Alternativamente:
.\.venv\Scripts\python.exe -m pytest -q
npm --prefix frontend test
npm --prefix frontend run build
```

Para desenvolvimento, rode FastAPI na porta 8000 e `npm --prefix frontend run dev` em outro terminal; Vite usa proxy `/api`. A API também serve o build de produção diretamente, dispensando dois processos para uso normal.

As fixtures geram partidas legais sintéticas, identificadas apenas como testes. Elas não acompanham a biblioteca do usuário. Testes cobrem identidade/cor, reconstrução, duplicação, PGN inválido, todas as ações reversíveis, promoções/roques/en passant, máscara legal, probabilidades, gradientes, contexto, pausa/retomada, fine-tuning, persistência, isolamento e fluxo HTTP.

Dados ficam em `data/` por padrão. Defina `$env:CHESSMIND_DATA = 'D:\ChessMindData'` antes de iniciar para usar outro local. Faça backup da pasta completa **com o servidor parado**. Modelos, PGNs e dados privados não são enviados ao GitHub; o repositório contém somente código e documentação.

## Referências técnicas

- [PyTorch TransformerEncoderLayer](https://docs.pytorch.org/docs/stable/generated/torch.nn.TransformerEncoderLayer.html)
- [python-chess](https://python-chess.readthedocs.io/en/latest/)
- [react-chessboard](https://github.com/Clariity/react-chessboard) — integração v5 via `options`, validada pelo build com a versão fixada no lockfile.

Dependências possuem licenças próprias; `python-chess` usa GPL-3.0+. Revise as obrigações de distribuição antes de redistribuir uma versão empacotada. Este repositório não atribui uma licença comercial em nome do proprietário.

