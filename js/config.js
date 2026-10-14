// Configuração central do dashboard.

export const SHEET_ID = '1keQUoUxuxeEz9QOeiep7txgM7S5EdCZZqSmQ73_j7H8';
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

// Intervalos lidos da planilha (endpoint gviz, que devolve valores brutos e aceita CORS).
// A faixa de avaliações vai até a linha 500 para que novos colaboradores entrem sozinhos.
export const RANGES = {
  avaliacoes: { sheet: 'Avaliações', range: 'A7:P500' },
  // Nomes e pesos em leituras separadas: com as duas linhas juntas o gviz trata a 1ª como cabeçalho.
  criteriosNomes: { sheet: 'Critérios', range: 'B5:K5' },
  criteriosPesos: { sheet: 'Critérios', range: 'B6:K6' },
  limiares: { sheet: 'Critérios', range: 'A24:B26' },
};

// Meses exibidos. O último é o mês "ao vivo" da planilha; os anteriores são
// histórico fictício gerado a partir dele (ver data.js -> buildHistory).
export const MONTHS = [
  { key: '2026-05', label: 'Mai', long: 'Maio 2026' },
  { key: '2026-06', label: 'Jun', long: 'Junho 2026' },
  { key: '2026-07', label: 'Jul', long: 'Julho 2026' },
  { key: '2026-08', label: 'Ago', long: 'Agosto 2026' },
  { key: '2026-09', label: 'Set', long: 'Setembro 2026' },
  { key: '2026-10', label: 'Out', long: 'Outubro 2026', live: true },
];

export const CLASSES = {
  ACIMA: { key: 'ACIMA', label: 'Acima do esperado', short: 'Acima', icon: '▲' },
  DENTRO: { key: 'DENTRO', label: 'Dentro do esperado', short: 'Dentro', icon: '●' },
  ABAIXO: { key: 'ABAIXO', label: 'Abaixo do esperado', short: 'Abaixo', icon: '▼' },
};
