// Autenticação e permissões por perfil.
//
// ATENÇÃO: isto é um showcase estático. A verificação de senha acontece no navegador,
// então não é segurança real — qualquer pessoa com acesso ao código pode contorná-la.
// Para produção, mova login e filtragem de dados para um backend (ex.: Apps Script,
// Supabase, Firebase) e nunca envie ao navegador dados que o usuário não pode ver.

const SESSION_KEY = 'aurora.session';

// Perfis previstos. Cada um define o escopo de dados visível e as telas liberadas.
export const ROLES = {
  ceo: {
    label: 'CEO',
    scope: 'all', // todos os colaboradores, todas as áreas
    views: ['overview', 'ranking', 'people', 'criteria'],
  },
  rh: {
    label: 'RH',
    scope: 'all',
    views: ['overview', 'ranking', 'people', 'criteria'],
  },
  gestor: {
    label: 'Gestor',
    scope: 'area', // apenas a própria área
    views: ['overview', 'ranking', 'people'],
  },
  colaborador: {
    label: 'Colaborador',
    scope: 'self', // apenas os próprios dados
    views: ['people'],
  },
};

// Contas. Senhas guardadas como SHA-256(salt + '::' + senha).
// Por enquanto só o CEO está ativo; as demais entram aqui quando os perfis forem liberados,
// ex.: { username: 'marina', name: 'Marina Duarte', role: 'colaborador', employee: 'Marina Duarte', ... }
//      { username: 'gestor.design', name: '...', role: 'gestor', area: 'Design', ... }
const ACCOUNTS = [
  {
    username: 'ceo',
    name: 'Diretoria Executiva',
    role: 'ceo',
    salt: 'aurora-digital::ceo',
    hash: '35f21ec2876b39424542ace5921397925ae60c4e8b7e6e912e977e0c1a7073b2',
  },
];

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function login(username, password) {
  const account = ACCOUNTS.find((a) => a.username === username.trim().toLowerCase());
  if (!account) return null;
  const hash = await sha256(`${account.salt}::${password}`);
  if (hash !== account.hash) return null;
  const session = {
    username: account.username,
    name: account.name,
    role: account.role,
    area: account.area ?? null,
    employee: account.employee ?? null,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function currentSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return s && ROLES[s.role] ? s : null;
  } catch {
    return null;
  }
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function canSee(session, view) {
  return ROLES[session.role].views.includes(view);
}

// Filtra a lista de colaboradores conforme o escopo do perfil.
export function scopeEmployees(session, employees) {
  const { scope } = ROLES[session.role];
  if (scope === 'all') return employees;
  if (scope === 'area') return employees.filter((e) => e.area === session.area);
  if (scope === 'self') return employees.filter((e) => e.name === session.employee);
  return [];
}
