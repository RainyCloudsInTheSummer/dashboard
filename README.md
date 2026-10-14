# Aurora Digital · Painel de performance

Dashboard de avaliação de desempenho conectado à
[planilha de avaliação](https://docs.google.com/spreadsheets/d/1keQUoUxuxeEz9QOeiep7txgM7S5EdCZZqSmQ73_j7H8/edit).
Showcase com dados fictícios.

## Rodar

```bash
node server.js
# abra http://localhost:5173
```

Sem dependências. Precisa ser servido via `http://localhost` (abrir o `index.html` direto do disco não funciona).

**Acesso de demonstração (CEO):** usuário `ceo` · senha `Aurora@CEO2026`

## Como funciona

- **Dados ao vivo:** lê as abas `Avaliações` e `Critérios` pelo endpoint público `gviz` do Google Sheets.
  Novos colaboradores (até a linha 500) e mudanças de pesos/limiares aparecem ao clicar em "Atualizar dados".
  Se a leitura falhar, usa a cópia em `data/snapshot.js` e avisa "Offline · cópia local".
- **Histórico:** a planilha só tem outubro/2026. Maio–setembro são **simulados** de forma determinística
  a partir dos dados reais (`buildHistory` em `js/data.js`), e a interface sinaliza isso.
- **Score e classificação:** recalculados no navegador com a mesma regra da planilha
  (`SUMPRODUCT` das notas pelos pesos; ≥ 90% acima, ≥ 70% dentro, senão abaixo).

## Estrutura

| Arquivo | Papel |
|---|---|
| `js/config.js` | ID da planilha, faixas lidas, meses, classificações |
| `js/auth.js` | Perfis (CEO, RH, gestor, colaborador), contas e escopo de dados |
| `js/data.js` | Leitura da planilha, histórico simulado, ranking e agregados |
| `js/charts.js` | Gráficos em SVG com tooltip |
| `js/app.js` | Telas: login, visão geral, ranking mensal, colaboradores, critérios |

## Perfis

Só o CEO está ativo. Os demais já estão modelados em `js/auth.js` (`ROLES` + `scopeEmployees`):
RH vê todos, gestor vê a própria área, colaborador vê só os próprios dados. Para ativar, adicione contas em `ACCOUNTS`.

> **Segurança:** o login é verificado no navegador, então serve para demonstração e não protege dados reais.
> Em produção, a autenticação e o filtro por perfil precisam ficar num backend (ex.: Supabase, Firebase,
> Apps Script), e a planilha não pode estar pública.
