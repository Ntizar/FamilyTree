
/**
 * @typedef {Object} Person
 * @property {string}   id
 * @property {string}   firstName
 * @property {string}   lastName1
 * @property {string}   lastName2
 * @property {string}   nickname
 * @property {"F"|"M"|"O"|""} gender
 * @property {string}   birthDate
 * @property {string}   birthPlace
 * @property {boolean}  deceased
 * @property {string}   deathDate
 * @property {string}   deathPlace
 * @property {string}   occupation
 * @property {string}   notes
 * @property {string|null} photo
 * @property {string|null} father
 * @property {string|null} mother
 * @property {string[]}  untypedParents
 * @property {string[]}  partners
 * @property {{x:number, y:number}|null} manualPosition
 * Invariantes:
 * - No padre duplicado, no madre duplicada.
 * - Hermanos siempre derivados de father/mother.
 * - Layout determinista por generaciones + unidades familiares.
 */
const DEBUG_MODE = new URLSearchParams(window.location.search).get('debug') === '1';
const LAYOUT = {
  CARD_W: 200,
  CARD_H: 160,
  ROW_HEIGHT: 240,
  MIN_GAP: 40,
  COUPLE_GAP: 60,
  UNIT_GAP: 90,
  Y_BASE: 100,
};
const CARD_WIDTH = LAYOUT.CARD_W;
const CARD_HEIGHT = LAYOUT.CARD_H;
const MAX_HISTORY = 50;

const state = {
  people: {},
  insertionOrder: [],
  relations: { parents: {}, partners: {} }, // compat cache (derivado)
  selectedId: null,
  viewMode: 'all',
  focusId: null,
  visibleFilter: null,
  view: { x: 0, y: 0, scale: 1 },
  layoutDirty: true,
  renderQueued: false,
  relationsDirty: true,
  undoStack: [],
  redoStack: [],
  darkMode: false,
  debug: {
    enabled: DEBUG_MODE,
    tests: [],
    lastResults: [],
    failCount: 0,
    highlightedChildrenByPartner: null,
  },
};

const UI_TEXT = {
  es: {
    search: 'Buscar persona...', load: 'Cargar', export: 'Exportar', print: 'Imprimir', guide: 'Guía', addPerson: 'Añadir persona', reorganize: 'Reorganizar',
    identity: 'Identidad', birth: 'Nacimiento', death: 'Fallecimiento', details: 'Más detalles', parents: 'Padres', partners: 'Parejas', children: 'Hijos', siblings: 'Hermanos',
    save: 'Guardar cambios', delete: 'Eliminar', viewBranches: 'Ver ramas', father: 'Padre', mother: 'Madre', parent: 'Progenitor',
    loaded: count => `Cargado: ${count} personas`, jsonDownloaded: 'Archivo JSON descargado', excelDownloaded: 'Archivo Excel descargado', linked: 'Vinculado',
    correctedInconsistencies: count => `Se corrigieron ${count} inconsistencias del archivo cargado.`,
    fullSibling: 'Completo', halfSibling: 'Medio',
  },
  en: {
    search: 'Search person...', load: 'Load', export: 'Export', print: 'Print', guide: 'Guide', addPerson: 'Add person', reorganize: 'Reorganize',
    identity: 'Identity', birth: 'Birth', death: 'Death', details: 'More details', parents: 'Parents', partners: 'Partners', children: 'Children', siblings: 'Siblings',
    save: 'Save changes', delete: 'Delete', viewBranches: 'Branches', father: 'Father', mother: 'Mother', parent: 'Parent',
    loaded: count => `Loaded: ${count} people`, jsonDownloaded: 'JSON file downloaded', excelDownloaded: 'Excel file downloaded', linked: 'Linked',
    correctedInconsistencies: count => `Fixed ${count} inconsistencies in the loaded file.`,
    fullSibling: 'Full', halfSibling: 'Half',
  },
};
let currentLang = 'es';

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function t(key, ...args) {
  const value = UI_TEXT[currentLang]?.[key] ?? UI_TEXT.es[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

function buildFullName(firstName = '', lastName1 = '', lastName2 = '') {
  return [firstName, lastName1, lastName2].map(part => String(part || '').trim()).filter(Boolean).join(' ');
}

function generatePersonId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function deepClone(value) {
  if (window.structuredClone) return window.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function parseBirthYear(value) {
  const year = parseInt(extractYear(value || ''), 10);
  return Number.isFinite(year) ? year : Number.MAX_SAFE_INTEGER;
}

function personOrderIndex(id) {
  const idx = state.insertionOrder.indexOf(id);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'father' || value === 'padre') return 'father';
  if (value === 'mother' || value === 'madre') return 'mother';
  return 'parent';
}

function normalizeParentEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string' || typeof entry === 'number') return { id: String(entry), role: 'parent' };
  if (typeof entry === 'object' && entry.id) return { id: String(entry.id), role: normalizeRole(entry.role) };
  return null;
}

function normalizePerson(person, { preserveRuntime = true } = {}) {
  if (!person) return person;
  const p = person;
  p.id = String(p.id || generatePersonId());
  p.firstName = String(p.firstName || p.givenName || '').trim();
  p.lastName1 = String(p.lastName1 || '').trim();
  p.lastName2 = String(p.lastName2 || '').trim();
  p.nickname = String(p.nickname || '').trim();
  p.gender = ['F', 'M', 'O', ''].includes(String(p.gender || '').toUpperCase()) ? String(p.gender || '').toUpperCase() : '';
  p.birthDate = String(p.birthDate || '').trim();
  p.birthPlace = String(p.birthPlace || '').trim();
  p.deceased = !!p.deceased;
  p.deathDate = String(p.deathDate || '').trim();
  p.deathPlace = String(p.deathPlace || '').trim();
  p.occupation = String(p.occupation || '').trim();
  p.notes = String(p.notes || '').trim();
  p.photo = p.photo ? String(p.photo) : null;
  if ((!p.firstName && !p.lastName1 && !p.lastName2) && p.name) {
    const parts = String(p.name).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 3) {
      p.firstName = parts.slice(0, -2).join(' ');
      p.lastName1 = parts[parts.length - 2];
      p.lastName2 = parts[parts.length - 1];
    } else if (parts.length === 2) {
      p.firstName = parts[0];
      p.lastName1 = parts[1];
    } else if (parts.length === 1) {
      p.firstName = parts[0];
    }
  }
  p.name = buildFullName(p.firstName, p.lastName1, p.lastName2) || String(p.name || '').trim() || 'Sin nombre';

  const fatherArray = Array.isArray(p.father) ? p.father.map(String).filter(Boolean) : null;
  const motherArray = Array.isArray(p.mother) ? p.mother.map(String).filter(Boolean) : null;

  p.father = fatherArray ? (fatherArray[0] || null) : (p.father ? String(p.father) : null);
  p.mother = motherArray ? (motherArray[0] || null) : (p.mother ? String(p.mother) : null);

  const migratedUntyped = [];
  if (fatherArray && fatherArray.length > 1) migratedUntyped.push(...fatherArray.slice(1));
  if (motherArray && motherArray.length > 1) migratedUntyped.push(...motherArray.slice(1));
  p.untypedParents = [...new Set([...(Array.isArray(p.untypedParents) ? p.untypedParents : []), ...migratedUntyped].map(String).filter(Boolean))];

  p.partners = [...new Set((Array.isArray(p.partners) ? p.partners : []).map(String).filter(Boolean))];
  if (p.manualPosition && Number.isFinite(Number(p.manualPosition.x)) && Number.isFinite(Number(p.manualPosition.y))) {
    p.manualPosition = { x: Number(p.manualPosition.x), y: Number(p.manualPosition.y) };
  } else {
    p.manualPosition = null;
  }
  if (preserveRuntime) {
    p.x = Number.isFinite(Number(p.x)) ? Number(p.x) : (p.manualPosition?.x ?? 0);
    p.y = Number.isFinite(Number(p.y)) ? Number(p.y) : (p.manualPosition?.y ?? 0);
  } else {
    delete p.x;
    delete p.y;
  }
  return p;
}

function displayName(person) {
  return normalizePerson(person)?.name || 'Sin nombre';
}

function relationRoleLabel(role) {
  return role === 'father' ? t('father') : role === 'mother' ? t('mother') : t('parent');
}

function roleForRelType(relType) {
  if (relType === 'father' || relType === 'mother') return relType;
  return 'parent';
}

function isParentRelType(relType) {
  return relType === 'parent' || relType === 'father' || relType === 'mother' || relType === 'untypedParent';
}

function shouldInferParentRole(relType) {
  return relType === undefined || relType === null || relType === 'parent';
}

function genderForRelType(relType) {
  if (relType === 'father') return 'M';
  if (relType === 'mother') return 'F';
  return '';
}

function inferRoleFromGender(person) {
  if (person?.gender === 'M') return 'father';
  if (person?.gender === 'F') return 'mother';
  return 'parent';
}

function extractYear(s) {
  const m = String(s).match(/\b(\d{4})\b/);
  return m ? m[1] : String(s || '');
}

function formatDates(p) {
  const b = p.birthDate ? extractYear(p.birthDate) : '';
  const d = p.deceased ? (p.deathDate ? extractYear(p.deathDate) : '') : '';
  if (!b && !d && !p.deceased) return '';
  if (b && d) return `${b} – ${d}`;
  if (b && p.deceased) return `${b} – ?`;
  if (b) return `n. ${b}`;
  if (d) return `† ${d}`;
  if (p.deceased) return '†';
  return '';
}

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function pushUndoSnapshot(snapshot) {
  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
}

function makeHistorySnapshot() {
  return {
    people: deepClone(state.people),
    insertionOrder: [...state.insertionOrder],
    selectedId: state.selectedId,
    viewMode: state.viewMode,
    focusId: state.focusId,
  };
}

function restoreHistorySnapshot(snapshot) {
  state.people = deepClone(snapshot.people);
  Object.values(state.people).forEach(person => normalizePerson(person));
  state.insertionOrder = [...snapshot.insertionOrder].filter(id => !!state.people[id]);
  state.selectedId = snapshot.selectedId && state.people[snapshot.selectedId] ? snapshot.selectedId : null;
  state.viewMode = snapshot.viewMode;
  state.focusId = snapshot.focusId && state.people[snapshot.focusId] ? snapshot.focusId : null;
  invalidateDerived();
  state.layoutDirty = true;
  scheduleRender();
}

function undoAction() {
  if (!state.undoStack.length) return false;
  const current = makeHistorySnapshot();
  const prev = state.undoStack.pop();
  state.redoStack.push(current);
  restoreHistorySnapshot(prev);
  return true;
}

function redoAction() {
  if (!state.redoStack.length) return false;
  const current = makeHistorySnapshot();
  const next = state.redoStack.pop();
  state.undoStack.push(current);
  restoreHistorySnapshot(next);
  return true;
}

function invalidateDerived() {
  state.relationsDirty = true;
}

function syncRelationsCache() {
  if (!state.relationsDirty) return;
  const parents = {};
  const partners = {};
  for (const person of Object.values(state.people)) {
    if (person.father) {
      if (!parents[person.id]) parents[person.id] = [];
      parents[person.id].push({ id: person.father, role: 'father' });
    }
    if (person.mother) {
      if (!parents[person.id]) parents[person.id] = [];
      parents[person.id].push({ id: person.mother, role: 'mother' });
    }
    for (const parentId of person.untypedParents) {
      if (!parents[person.id]) parents[person.id] = [];
      parents[person.id].push({ id: parentId, role: 'parent' });
    }
    partners[person.id] = [...person.partners];
  }
  state.relations = { parents, partners };
  state.relationsDirty = false;
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    render();
  });
}

function sanitizePeopleMap(rawPeople = {}) {
  const people = {};
  if (Array.isArray(rawPeople)) {
    rawPeople.forEach((person, index) => {
      const id = String(person?.id || ('p_' + (index + 1)));
      const normalized = normalizePerson({ ...person, id });
      normalized._order = Number.isFinite(Number(person?._order)) ? Number(person._order) : index;
      people[id] = normalized;
    });
  } else {
    let idx = 0;
    for (const [key, person] of Object.entries(rawPeople || {})) {
      const id = String(person?.id || key);
      const normalized = normalizePerson({ ...person, id });
      normalized._order = Number.isFinite(Number(person?._order)) ? Number(person._order) : idx++;
      people[id] = normalized;
    }
  }
  return people;
}

const Tree = {
  _result(ok, payload = {}) {
    return { ok, warnings: payload.warnings || [], conflicts: payload.conflicts || [], reason: payload.reason || '' };
  },

  _withMutation(mutator, { affectsLayout = true, pushHistory = true, invalidateRelations = true } = {}) {
    const snapshot = pushHistory ? makeHistorySnapshot() : null;
    const outcome = mutator();
    if (!outcome?.ok) {
      if (snapshot) {
        state.people = snapshot.people;
        state.insertionOrder = snapshot.insertionOrder;
        state.selectedId = snapshot.selectedId;
        state.viewMode = snapshot.viewMode;
        state.focusId = snapshot.focusId;
        invalidateDerived();
      }
      return outcome;
    }
    if (pushHistory) {
      pushUndoSnapshot(snapshot);
      state.redoStack = [];
    }
    if (invalidateRelations) invalidateDerived();
    if (affectsLayout) state.layoutDirty = true;
    scheduleRender();
    scheduleAutoSave();
    return outcome;
  },

  _registerPerson(person) {
    normalizePerson(person);
    if (!state.people[person.id]) state.insertionOrder.push(person.id);
    if (!Number.isFinite(Number(person._order))) person._order = state.insertionOrder.length - 1;
    state.people[person.id] = person;
  },

  get(id) { return state.people[id]; },

  getChildren(id) {
    return state.insertionOrder
      .map(pid => state.people[pid])
      .filter(p => p && (p.father === id || p.mother === id || p.untypedParents.includes(id)));
  },

  getSiblings(id, { includeHalf = true } = {}) {
    const me = state.people[id];
    if (!me) return [];
    return state.insertionOrder
      .map(pid => state.people[pid])
      .filter(other => {
        if (!other || other.id === id) return false;
        const shareF = !!me.father && other.father === me.father;
        const shareM = !!me.mother && other.mother === me.mother;
        if (includeHalf) return shareF || shareM;
        return shareF && shareM;
      });
  },

  getFullSiblings(id) { return this.getSiblings(id, { includeHalf: false }); },

  getHalfSiblings(id) {
    const me = state.people[id];
    if (!me) return [];
    return this.getSiblings(id, { includeHalf: true }).filter(other => {
      const shareF = !!me.father && other.father === me.father;
      const shareM = !!me.mother && other.mother === me.mother;
      return (shareF || shareM) && !(shareF && shareM);
    });
  },

  getAncestors(id) {
    const ancestors = new Set();
    const queue = [id];
    while (queue.length) {
      const current = queue.shift();
      const person = state.people[current];
      if (!person) continue;
      const parents = [person.father, person.mother, ...person.untypedParents].filter(Boolean);
      for (const parentId of parents) {
        if (!state.people[parentId] || ancestors.has(parentId)) continue;
        ancestors.add(parentId);
        queue.push(parentId);
      }
    }
    return ancestors;
  },

  getDescendants(id) {
    const descendants = new Set();
    const queue = [id];
    while (queue.length) {
      const current = queue.shift();
      for (const child of this.getChildren(current)) {
        if (descendants.has(child.id)) continue;
        descendants.add(child.id);
        queue.push(child.id);
      }
    }
    return descendants;
  },

  getCouples() {
    const pairs = new Set();
    for (const aId of state.insertionOrder) {
      const person = state.people[aId];
      if (!person) continue;
      for (const bId of person.partners) {
        if (!state.people[bId]) continue;
        const key = [aId, bId].sort().join('|');
        pairs.add(key);
      }
    }
    return [...pairs].map(key => key.split('|'));
  },

  detectCycle(childId, parentId) {
    if (childId === parentId) return true;
    const ancestors = this.getAncestors(parentId);
    return ancestors.has(childId);
  },

  canSetParent(childId, parentId, role) {
    const child = state.people[childId];
    const parent = state.people[parentId];
    if (!child || !parent) return this._result(false, { reason: 'Persona no encontrada.' });
    if (childId === parentId) return this._result(false, { reason: 'Una persona no puede ser su propio progenitor.' });
    if (this.detectCycle(childId, parentId)) return this._result(false, { reason: 'La relación crearía un ciclo de ancestros.' });
    const normalizedRole = role === 'father' ? 'father' : role === 'mother' ? 'mother' : 'parent';
    if (normalizedRole === 'father' && child.mother === parentId) return this._result(false, { reason: 'No se puede usar la misma persona como padre y madre.' });
    if (normalizedRole === 'mother' && child.father === parentId) return this._result(false, { reason: 'No se puede usar la misma persona como madre y padre.' });
    return this._result(true);
  },

  addPerson(partial = {}, { pushHistory = true } = {}) {
    return this._withMutation(() => {
      const person = normalizePerson({
        id: String(partial.id || generatePersonId()),
        ...partial,
      });
      if (state.people[person.id]) return this._result(false, { reason: 'El ID ya existe.' });
      person._order = state.insertionOrder.length;
      if (!person.manualPosition) {
        person.x = 0;
        person.y = 0;
      }
      this._registerPerson(person);
      return this._result(true, { createdId: person.id });
    }, { affectsLayout: true, pushHistory });
  },

  updatePerson(id, patch = {}, { pushHistory = true, affectsLayout = false } = {}) {
    const touchesRelations = ['father', 'mother', 'untypedParents', 'partners'].some(key => Object.prototype.hasOwnProperty.call(patch, key));
    return this._withMutation(() => {
      const current = state.people[id];
      if (!current) return this._result(false, { reason: 'Persona no encontrada.' });
      const merged = normalizePerson({ ...current, ...patch, id });
      merged._order = current._order;
      this._registerPerson(merged);
      return this._result(true);
    }, { affectsLayout, pushHistory, invalidateRelations: touchesRelations });
  },

  deletePerson(id, { pushHistory = true } = {}) {
    return this._withMutation(() => {
      if (!state.people[id]) return this._result(false, { reason: 'Persona no encontrada.' });
      delete state.people[id];
      state.insertionOrder = state.insertionOrder.filter(pid => pid !== id);
      for (const person of Object.values(state.people)) {
        if (person.father === id) person.father = null;
        if (person.mother === id) person.mother = null;
        person.untypedParents = person.untypedParents.filter(parentId => parentId !== id);
        person.partners = person.partners.filter(partnerId => partnerId !== id);
      }
      if (state.focusId === id) {
        state.viewMode = 'all';
        state.focusId = null;
      }
      if (state.selectedId === id) state.selectedId = null;
      return this._result(true);
    }, { affectsLayout: true, pushHistory });
  },

  setFather(childId, fatherId, { confirmReplace } = {}) {
    return this._withMutation(() => {
      const can = this.canSetParent(childId, fatherId, 'father');
      if (!can.ok) return can;
      const child = state.people[childId];
      const warnings = [];
      if (child.father && child.father !== fatherId) {
        const previousFather = state.people[child.father];
        const nextFather = state.people[fatherId];
        const decision = confirmReplace
          ? confirmReplace({ child, previous: previousFather, next: nextFather, role: 'father' })
          : 'replace';
        if (decision === 'cancel') return this._result(false, { reason: 'Operación cancelada.' });
        if (decision === 'convert' && child.father) child.untypedParents = [...new Set([...child.untypedParents, child.father])];
      }
      child.father = fatherId;
      child.untypedParents = child.untypedParents.filter(pid => pid !== fatherId);
      if (child.mother === fatherId) child.mother = null;
      const father = state.people[fatherId];
      if (father?.gender === 'F') warnings.push(`${displayName(father)} está marcada como Femenino y se añade como padre.`);
      return this._result(true, { warnings });
    });
  },

  setMother(childId, motherId, { confirmReplace } = {}) {
    return this._withMutation(() => {
      const can = this.canSetParent(childId, motherId, 'mother');
      if (!can.ok) return can;
      const child = state.people[childId];
      const warnings = [];
      if (child.mother && child.mother !== motherId) {
        const previousMother = state.people[child.mother];
        const nextMother = state.people[motherId];
        const decision = confirmReplace
          ? confirmReplace({ child, previous: previousMother, next: nextMother, role: 'mother' })
          : 'replace';
        if (decision === 'cancel') return this._result(false, { reason: 'Operación cancelada.' });
        if (decision === 'convert' && child.mother) child.untypedParents = [...new Set([...child.untypedParents, child.mother])];
      }
      child.mother = motherId;
      child.untypedParents = child.untypedParents.filter(pid => pid !== motherId);
      if (child.father === motherId) child.father = null;
      const mother = state.people[motherId];
      if (mother?.gender === 'M') warnings.push(`${displayName(mother)} está marcada como Masculino y se añade como madre.`);
      return this._result(true, { warnings });
    });
  },

  clearFather(childId) {
    return this._withMutation(() => {
      const child = state.people[childId];
      if (!child) return this._result(false, { reason: 'Persona no encontrada.' });
      child.father = null;
      return this._result(true);
    });
  },

  clearMother(childId) {
    return this._withMutation(() => {
      const child = state.people[childId];
      if (!child) return this._result(false, { reason: 'Persona no encontrada.' });
      child.mother = null;
      return this._result(true);
    });
  },

  addUntypedParent(childId, parentId) {
    return this._withMutation(() => {
      const can = this.canSetParent(childId, parentId, 'parent');
      if (!can.ok) return can;
      const child = state.people[childId];
      if (child.father === parentId || child.mother === parentId) return this._result(true);
      child.untypedParents = [...new Set([...child.untypedParents, parentId])];
      return this._result(true);
    });
  },

  removeParent(childId, parentId) {
    return this._withMutation(() => {
      const child = state.people[childId];
      if (!child) return this._result(false, { reason: 'Persona no encontrada.' });
      if (child.father === parentId) child.father = null;
      if (child.mother === parentId) child.mother = null;
      child.untypedParents = child.untypedParents.filter(pid => pid !== parentId);
      return this._result(true);
    });
  },

  convertParentRole(childId, parentId, targetRole, { confirmReplace } = {}) {
    return this._withMutation(() => {
      const child = state.people[childId];
      if (!child || !state.people[parentId]) return this._result(false, { reason: 'Persona no encontrada.' });
      if (child.father === parentId) child.father = null;
      if (child.mother === parentId) child.mother = null;
      child.untypedParents = child.untypedParents.filter(pid => pid !== parentId);

      if (targetRole === 'father') {
        if (child.mother === parentId) return this._result(false, { reason: 'No se puede duplicar rol.' });
        if (child.father && child.father !== parentId) {
          const decision = confirmReplace
            ? confirmReplace({ child, previous: state.people[child.father], next: state.people[parentId], role: 'father' })
            : 'replace';
          if (decision === 'cancel') return this._result(false, { reason: 'Operación cancelada.' });
          if (decision === 'convert') child.untypedParents = [...new Set([...child.untypedParents, child.father])];
        }
        child.father = parentId;
      } else if (targetRole === 'mother') {
        if (child.father === parentId) return this._result(false, { reason: 'No se puede duplicar rol.' });
        if (child.mother && child.mother !== parentId) {
          const decision = confirmReplace
            ? confirmReplace({ child, previous: state.people[child.mother], next: state.people[parentId], role: 'mother' })
            : 'replace';
          if (decision === 'cancel') return this._result(false, { reason: 'Operación cancelada.' });
          if (decision === 'convert') child.untypedParents = [...new Set([...child.untypedParents, child.mother])];
        }
        child.mother = parentId;
      } else {
        child.untypedParents = [...new Set([...child.untypedParents, parentId])];
      }
      return this._result(true);
    });
  },

  addPartner(aId, bId) {
    return this._withMutation(() => {
      if (!state.people[aId] || !state.people[bId] || aId === bId) return this._result(false, { reason: 'Pareja no válida.' });
      state.people[aId].partners = [...new Set([...state.people[aId].partners, bId])];
      state.people[bId].partners = [...new Set([...state.people[bId].partners, aId])];
      return this._result(true);
    });
  },

  removePartner(aId, bId) {
    return this._withMutation(() => {
      if (!state.people[aId] || !state.people[bId]) return this._result(false, { reason: 'Pareja no encontrada.' });
      state.people[aId].partners = state.people[aId].partners.filter(pid => pid !== bId);
      state.people[bId].partners = state.people[bId].partners.filter(pid => pid !== aId);
      return this._result(true);
    });
  },

  clearManualPositions(ids = null) {
    return this._withMutation(() => {
      const targetIds = Array.isArray(ids) ? ids : state.insertionOrder;
      for (const id of targetIds) {
        const person = state.people[id];
        if (!person) continue;
        person.manualPosition = null;
      }
      return this._result(true);
    }, { affectsLayout: true });
  },

  addChildOf(parentId, partial = {}, { coParentId = null } = {}) {
    return this._withMutation(() => {
      const parent = state.people[parentId];
      if (!parent) return this._result(false, { reason: 'Progenitor no encontrado.' });
      const childId = String(partial.id || generatePersonId());
      if (state.people[childId]) return this._result(false, { reason: 'El ID ya existe.' });
      const child = normalizePerson({ ...partial, id: childId });
      child._order = state.insertionOrder.length;
      this._registerPerson(child);
      if (inferRoleFromGender(parent) === 'mother') child.mother = parentId;
      else child.father = parentId;
      if (coParentId && state.people[coParentId] && coParentId !== parentId) {
        const coParentRole = inferRoleFromGender(state.people[coParentId]);
        if (coParentRole === 'mother' && !child.mother) child.mother = coParentId;
        else if (coParentRole === 'father' && !child.father) child.father = coParentId;
        else child.untypedParents = [...new Set([...child.untypedParents, coParentId])];
      }
      return this._result(true, { createdId: childId });
    });
  },

  addSiblingOf(siblingId, partial = {}) {
    return this._withMutation(() => {
      const sibling = state.people[siblingId];
      if (!sibling) return this._result(false, { reason: 'Persona no encontrada.' });
      let father = sibling.father;
      let mother = sibling.mother;
      if (!father && !mother) return this._result(false, { reason: 'needs-placeholder' });
      const newId = String(partial.id || generatePersonId());
      if (state.people[newId]) return this._result(false, { reason: 'El ID ya existe.' });
      const person = normalizePerson({ ...partial, id: newId });
      person._order = state.insertionOrder.length;
      person.father = father || null;
      person.mother = mother || null;
      this._registerPerson(person);
      return this._result(true, { createdId: newId });
    });
  },

  addParentOf(childId, partial = {}, { role = 'untyped' } = {}) {
    return this._withMutation(() => {
      const child = state.people[childId];
      if (!child) return this._result(false, { reason: 'Persona no encontrada.' });
      const parentId = String(partial.id || generatePersonId());
      if (state.people[parentId]) return this._result(false, { reason: 'El ID ya existe.' });
      const parent = normalizePerson({ ...partial, id: parentId });
      parent._order = state.insertionOrder.length;
      this._registerPerson(parent);
      if (role === 'father') child.father = parentId;
      else if (role === 'mother') child.mother = parentId;
      else child.untypedParents = [...new Set([...child.untypedParents, parentId])];
      return this._result(true, { createdId: parentId });
    });
  },

  addPartnerOf(personId, partial = {}) {
    return this._withMutation(() => {
      const person = state.people[personId];
      if (!person) return this._result(false, { reason: 'Persona no encontrada.' });
      const partnerId = String(partial.id || generatePersonId());
      if (state.people[partnerId]) return this._result(false, { reason: 'El ID ya existe.' });
      const partner = normalizePerson({ ...partial, id: partnerId });
      partner._order = state.insertionOrder.length;
      this._registerPerson(partner);
      person.partners = [...new Set([...person.partners, partnerId])];
      partner.partners = [...new Set([...partner.partners, personId])];
      return this._result(true, { createdId: partnerId });
    });
  },

  sanitize(rawState = {}) {
    const fixes = [];
    if (rawState.siblings) fixes.push('ignored-legacy-siblings');
    const migrated = sanitizePeopleMap(rawState.people || rawState.personas || (Array.isArray(rawState) ? rawState : {}));
    const relations = rawState.relations || { parents: {}, partners: {} };
    for (const person of Object.values(migrated)) {
      if (!Array.isArray(person.untypedParents)) {
        person.untypedParents = [];
        fixes.push('missing-untyped-parents');
      }
      if ('siblings' in person) {
        delete person.siblings;
        fixes.push('ignored-legacy-siblings');
      }
    }
    for (const [childId, entries] of Object.entries(relations.parents || {})) {
      const child = migrated[childId];
      if (!child) continue;
      const list = Array.isArray(entries) ? entries : Object.values(entries || {});
      for (const entry of list) {
        const parent = normalizeParentEntry(entry);
        if (!parent || !migrated[parent.id] || parent.id === childId) continue;
        const inferredRole = parent.role === 'parent' ? inferRoleFromGender(migrated[parent.id]) : parent.role;
        if (inferredRole === 'father') {
          if (!child.father) child.father = parent.id;
          else if (child.father !== parent.id) {
            child.untypedParents = [...new Set([...child.untypedParents, parent.id])];
            fixes.push('extra-father-moved-to-untyped');
          }
        } else if (inferredRole === 'mother') {
          if (!child.mother) child.mother = parent.id;
          else if (child.mother !== parent.id) {
            child.untypedParents = [...new Set([...child.untypedParents, parent.id])];
            fixes.push('extra-mother-moved-to-untyped');
          }
        } else {
          child.untypedParents = [...new Set([...child.untypedParents, parent.id])];
        }
      }
    }
    for (const [aId, partners] of Object.entries(relations.partners || {})) {
      if (!migrated[aId]) continue;
      const list = Array.isArray(partners) ? partners : Object.values(partners || {});
      for (const p of list) {
        const bId = typeof p === 'object' ? String(p.id || '') : String(p || '');
        if (!bId || !migrated[bId] || bId === aId) continue;
        migrated[aId].partners = [...new Set([...migrated[aId].partners, bId])];
      }
    }
    for (const person of Object.values(migrated)) {
      if (person.father && !migrated[person.father]) {
        person.father = null;
        fixes.push('father-not-found');
      }
      if (person.mother && !migrated[person.mother]) {
        person.mother = null;
        fixes.push('mother-not-found');
      }
      if (person.father && person.mother && person.father === person.mother) {
        if (!person.untypedParents.includes(person.mother)) person.untypedParents.push(person.mother);
        person.mother = null;
        fixes.push('same-father-and-mother');
      }
      person.untypedParents = [...new Set(person.untypedParents.filter(pid => pid !== person.id && !!migrated[pid] && pid !== person.father && pid !== person.mother))];
      const validPartners = person.partners.filter(pid => pid !== person.id && !!migrated[pid]);
      if (validPartners.length !== person.partners.length) fixes.push('removed-invalid-partner');
      person.partners = [...new Set(validPartners)];
    }
    for (const person of Object.values(migrated)) {
      for (const partnerId of [...person.partners]) {
        if (!migrated[partnerId].partners.includes(person.id)) {
          migrated[partnerId].partners.push(person.id);
          fixes.push('forced-partner-symmetry');
        }
      }
    }
    const hasPathTo = (startId, targetId, visited = new Set()) => {
      if (startId === targetId) return true;
      if (visited.has(startId)) return false;
      visited.add(startId);
      const person = migrated[startId];
      if (!person) return false;
      const next = [person.father, person.mother].filter(Boolean);
      for (const parentId of next) {
        if (hasPathTo(parentId, targetId, visited)) return true;
      }
      return false;
    };
    for (const person of Object.values(migrated)) {
      if (person.father && hasPathTo(person.father, person.id)) {
        person.father = null;
        fixes.push('cycle-broken-father');
      }
      if (person.mother && hasPathTo(person.mother, person.id)) {
        person.mother = null;
        fixes.push('cycle-broken-mother');
      }
    }
    const normalizedInsertion = Array.isArray(rawState.insertionOrder) ? rawState.insertionOrder.map(String) : null;
    const orderedIds = normalizedInsertion
      ? [...normalizedInsertion.filter(id => !!migrated[id]), ...Object.keys(migrated).filter(id => !normalizedInsertion.includes(id))]
      : Object.values(migrated).sort((a, b) => (a._order ?? 0) - (b._order ?? 0)).map(p => p.id);
    return { state: { people: migrated, insertionOrder: orderedIds }, fixes };
  },
};

function normalizeRelations(relations = {}, people = state.people) {
  const compatible = { parents: {}, partners: {} };
  for (const person of Object.values(people || {})) {
    if (person.father) {
      if (!compatible.parents[person.id]) compatible.parents[person.id] = [];
      compatible.parents[person.id].push({ id: person.father, role: 'father' });
    }
    if (person.mother) {
      if (!compatible.parents[person.id]) compatible.parents[person.id] = [];
      compatible.parents[person.id].push({ id: person.mother, role: 'mother' });
    }
    for (const up of person.untypedParents || []) {
      if (!compatible.parents[person.id]) compatible.parents[person.id] = [];
      compatible.parents[person.id].push({ id: up, role: 'parent' });
    }
    compatible.partners[person.id] = [...(person.partners || [])];
  }
  return compatible;
}

function newPerson(data = {}) {
  const result = Tree.addPerson(data);
  if (!result.ok) return null;
  return state.people[result.createdId];
}

function parentEntries(id) {
  const person = state.people[id];
  if (!person) return [];
  const items = [];
  if (person.father) items.push({ id: person.father, role: 'father' });
  if (person.mother) items.push({ id: person.mother, role: 'mother' });
  for (const pid of person.untypedParents) items.push({ id: pid, role: 'parent' });
  return items.filter(item => !!state.people[item.id]);
}

function parentIds(id, active = null) {
  return parentEntries(id).map(parent => parent.id).filter(parentId => !active || active.has(parentId));
}

function partnerIds(id, active = null) {
  const person = state.people[id];
  if (!person) return [];
  return person.partners.filter(pid => !!state.people[pid] && (!active || active.has(pid)));
}

function getParents(id) {
  return parentEntries(id).map(parent => state.people[parent.id]).filter(Boolean);
}

function getChildren(id) {
  return Tree.getChildren(id);
}

function getPartners(id) {
  return partnerIds(id).map(pid => state.people[pid]).filter(Boolean);
}

function getSiblings(id, options = { includeHalf: true }) {
  return Tree.getSiblings(id, options);
}

function getSiblingKind(id, siblingId) {
  const me = state.people[id];
  const other = state.people[siblingId];
  if (!me || !other) return '';
  const shareF = !!me.father && other.father === me.father;
  const shareM = !!me.mother && other.mother === me.mother;
  if (shareF && shareM) return 'full';
  if (shareF || shareM) return 'half';
  return '';
}

function addParentChild(parentId, childId, role = 'parent') {
  let result;
  if (role === 'father') result = Tree.setFather(childId, parentId, { confirmReplace: askReplaceParent });
  else if (role === 'mother') result = Tree.setMother(childId, parentId, { confirmReplace: askReplaceParent });
  else result = Tree.addUntypedParent(childId, parentId);
  if (!result.ok && result.reason) toast(result.reason);
  if (result.warnings?.length) result.warnings.forEach(message => toast(message));
  return result.ok;
}

function addPartnership(a, b) {
  const result = Tree.addPartner(a, b);
  if (!result.ok && result.reason) toast(result.reason);
  return result.ok;
}

function removeParentChild(parentId, childId) {
  const result = Tree.removeParent(childId, parentId);
  if (!result.ok && result.reason) toast(result.reason);
  return result.ok;
}

function removePartnership(a, b) {
  const result = Tree.removePartner(a, b);
  if (!result.ok && result.reason) toast(result.reason);
  return result.ok;
}

function deletePerson(id) {
  const result = Tree.deletePerson(id);
  if (!result.ok && result.reason) toast(result.reason);
  return result.ok;
}

function askReplaceParent({ child, previous, next, role }) {
  const roleLabel = role === 'father' ? 'padre' : 'madre';
  const prevName = previous ? displayName(previous) : 'desconocido';
  const nextName = next ? displayName(next) : 'desconocido';
  const answer = window.prompt(
    `Esta persona ya tiene ${roleLabel} asignado (${prevName}).\n` +
    `R = reemplazar por ${nextName}\n` +
    `C = convertir ${prevName} en progenitor sin especificar\n` +
    `X = cancelar`,
    'R'
  );
  if (answer === null) return 'cancel';
  const normalized = String(answer || '').trim().toUpperCase();
  if (normalized === 'X') return 'cancel';
  if (normalized === 'C') return 'convert';
  return 'replace';
}

function visibleIds() {
  const ids = new Set(state.insertionOrder.filter(id => !!state.people[id]));
  if (state.visibleFilter) return new Set([...ids].filter(id => state.visibleFilter.has(id)));
  if (state.viewMode !== 'direct' || !state.focusId || !state.people[state.focusId]) return ids;
  return getDirectBranchIds(state.focusId);
}

function getDirectBranchIds(rootId) {
  const keep = new Set([rootId]);
  for (const ancestor of Tree.getAncestors(rootId)) keep.add(ancestor);
  for (const descendant of Tree.getDescendants(rootId)) keep.add(descendant);
  for (const id of [...keep]) {
    for (const partner of getPartners(id)) keep.add(partner.id);
  }
  addFamilyContext(keep);
  return keep;
}

function addFamilyContext(keep) {
  let changed = true;
  let safety = 20;
  while (changed && safety-- > 0) {
    changed = false;
    for (const id of [...keep]) {
      for (const partnerId of partnerIds(id)) {
        if (!keep.has(partnerId)) { keep.add(partnerId); changed = true; }
      }
      for (const parentId of parentIds(id)) {
        if (!keep.has(parentId)) { keep.add(parentId); changed = true; }
      }
      for (const child of getChildren(id)) {
        if (!keep.has(child.id)) { keep.add(child.id); changed = true; }
      }
    }
  }
}

function mapByGeneration(ids, generation) {
  const byGen = {};
  for (const id of ids) {
    const g = generation[id] ?? 0;
    if (!byGen[g]) byGen[g] = [];
    byGen[g].push(id);
  }
  return byGen;
}

function enforceCoupleAdjacency(order, generation) {
  const couples = Tree.getCouples()
    .filter(([a, b]) => generation[a] === generation[b])
    .sort((a, b) => Math.min(personOrderIndex(a[0]), personOrderIndex(a[1])) - Math.min(personOrderIndex(b[0]), personOrderIndex(b[1])));
  for (const [a, b] of couples) {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 || ib === -1 || Math.abs(ia - ib) <= 1) continue;
    const from = ib;
    const target = ia < ib ? ia + 1 : ia;
    const [moved] = order.splice(from, 1);
    order.splice(target, 0, moved);
  }
}

function computeGeneration(ids) {
  const generation = {};
  const ordered = [...ids].sort((a, b) => personOrderIndex(a) - personOrderIndex(b));
  for (const id of ordered) generation[id] = 0;

  let changed = true;
  let safety = ids.length * 8;
  while (changed && safety-- > 0) {
    changed = false;
    for (const id of ordered) {
      const parents = parentIds(id).filter(pid => ids.includes(pid));
      if (!parents.length) continue;
      const target = Math.max(...parents.map(pid => generation[pid] ?? 0)) + 1;
      if ((generation[id] ?? 0) !== target) {
        generation[id] = target;
        changed = true;
      }
    }
    for (const [a, b] of Tree.getCouples()) {
      if (!ids.includes(a) || !ids.includes(b)) continue;
      const maxGen = Math.max(generation[a] ?? 0, generation[b] ?? 0);
      if ((generation[a] ?? 0) !== maxGen) { generation[a] = maxGen; changed = true; }
      if ((generation[b] ?? 0) !== maxGen) { generation[b] = maxGen; changed = true; }
    }
  }
  return generation;
}

function getParentAnchor(id, positions) {
  const p = positions[id];
  if (!p) return null;
  return { x: p.x + CARD_WIDTH / 2, y: p.y + CARD_HEIGHT / 2 };
}

function buildFamilyUnits(ids, generation) {
  const unitsByKey = {};
  for (const id of ids) {
    const child = state.people[id];
    if (!child) continue;
    if (child.father || child.mother) {
      const key = `fm|${child.father || ''}|${child.mother || ''}`;
      if (!unitsByKey[key]) unitsByKey[key] = { key, father: child.father || null, mother: child.mother || null, parents: [child.father, child.mother].filter(Boolean), children: [] };
      unitsByKey[key].children.push(id);
      continue;
    }
    for (const parentId of child.untypedParents) {
      const key = `u|${parentId}`;
      if (!unitsByKey[key]) unitsByKey[key] = { key, father: null, mother: null, parents: [parentId], children: [] };
      unitsByKey[key].children.push(id);
    }
  }
  for (const [aId, bId] of Tree.getCouples()) {
    if (!ids.includes(aId) || !ids.includes(bId)) continue;
    const key = `pair|${[aId, bId].sort().join('|')}`;
    if (!unitsByKey[key]) unitsByKey[key] = { key, father: null, mother: null, parents: [aId, bId], children: [] };
  }
  const units = Object.values(unitsByKey).map(unit => ({
    ...unit,
    children: [...new Set(unit.children)].sort((a, b) => personOrderIndex(a) - personOrderIndex(b)),
    gen: unit.children.length
      ? Math.max(...unit.children.map(cid => generation[cid] ?? 0)) - 1
      : Math.max(...unit.parents.map(pid => generation[pid] ?? 0)),
  }));
  return units;
}

function resolveRowCollisions(rowIds, positions) {
  const sorted = [...rowIds].sort((a, b) => positions[a].x - positions[b].x);
  for (let i = 1; i < sorted.length; i++) {
    const prevId = sorted[i - 1];
    const currentId = sorted[i];
    const prev = positions[prevId];
    const current = positions[currentId];
    const minX = prev.x + CARD_WIDTH + LAYOUT.MIN_GAP;
    if (current.x >= minX) continue;
    const prevManual = !!state.people[prevId]?.manualPosition;
    const currentManual = !!state.people[currentId]?.manualPosition;
    if (!currentManual) {
      current.x = minX;
    } else if (!prevManual) {
      prev.x = current.x - (CARD_WIDTH + LAYOUT.MIN_GAP);
    }
  }
}

function reorderByBarycenter(rowIds, barycenterMap) {
  return [...rowIds].sort((a, b) => {
    const ba = barycenterMap[a] ?? Number.MAX_SAFE_INTEGER;
    const bb = barycenterMap[b] ?? Number.MAX_SAFE_INTEGER;
    if (ba !== bb) return ba - bb;
    const sa = state.people[a];
    const sb = state.people[b];
    const skA = `${sa?.father || ''}|${sa?.mother || ''}`;
    const skB = `${sb?.father || ''}|${sb?.mother || ''}`;
    if (skA !== skB) return skA.localeCompare(skB);
    const birthDiff = parseBirthYear(sa?.birthDate) - parseBirthYear(sb?.birthDate);
    if (birthDiff !== 0) return birthDiff;
    return personOrderIndex(a) - personOrderIndex(b);
  });
}

function computeLayout() {
  const ids = [...visibleIds()];
  if (!ids.length) {
    state.layoutDirty = false;
    return;
  }
  syncRelationsCache();
  const generation = computeGeneration(ids);
  const byGen = mapByGeneration(ids, generation);
  const gens = Object.keys(byGen).map(Number).sort((a, b) => a - b);
  const maxGen = gens.length ? Math.max(...gens) : 0;
  const orderByGen = {};

  for (const g of gens) {
    orderByGen[g] = [...byGen[g]].sort((a, b) => personOrderIndex(a) - personOrderIndex(b));
  }

  for (let pass = 0; pass < 4; pass++) {
    for (let g = maxGen; g >= 0; g--) {
      const row = orderByGen[g] || [];
      const lower = orderByGen[g + 1] || [];
      const lowerIndex = new Map(lower.map((id, idx) => [id, idx]));
      const bary = {};
      for (const id of row) {
        const children = getChildren(id).map(p => p.id).filter(cid => generation[cid] === g + 1);
        if (!children.length) continue;
        bary[id] = children.reduce((sum, cid) => sum + (lowerIndex.get(cid) ?? 0), 0) / children.length;
      }
      orderByGen[g] = reorderByBarycenter(row, bary);
      enforceCoupleAdjacency(orderByGen[g], generation);
    }
    for (let g = 1; g <= maxGen; g++) {
      const row = orderByGen[g] || [];
      const upper = orderByGen[g - 1] || [];
      const upperIndex = new Map(upper.map((id, idx) => [id, idx]));
      const bary = {};
      for (const id of row) {
        const parents = parentIds(id).filter(pid => generation[pid] === g - 1);
        if (!parents.length) continue;
        bary[id] = parents.reduce((sum, pid) => sum + (upperIndex.get(pid) ?? 0), 0) / parents.length;
      }
      orderByGen[g] = reorderByBarycenter(row, bary);
      enforceCoupleAdjacency(orderByGen[g], generation);
    }
  }

  const positions = {};
  for (const g of gens) {
    const row = orderByGen[g];
    let cursorX = 0;
    let previousFamilyKey = '';
    for (const id of row) {
      const person = state.people[id];
      const familyKey = `${person.father || ''}|${person.mother || ''}|${person.untypedParents.join(',')}`;
      if (previousFamilyKey && familyKey !== previousFamilyKey) cursorX += LAYOUT.UNIT_GAP;
      const manual = person.manualPosition;
      if (manual) {
        positions[id] = { x: manual.x, y: manual.y };
      } else {
        positions[id] = { x: cursorX, y: LAYOUT.Y_BASE + g * LAYOUT.ROW_HEIGHT };
      }
      cursorX = Math.max(cursorX + CARD_WIDTH + LAYOUT.MIN_GAP, positions[id].x + CARD_WIDTH + LAYOUT.MIN_GAP);
      previousFamilyKey = familyKey;
    }
    resolveRowCollisions(row, positions);
  }

  const units = buildFamilyUnits(ids, generation);
  for (let iter = 0; iter < 5; iter++) {
    let maxDelta = 0;
    for (const unit of units) {
      const children = unit.children.filter(cid => positions[cid]);
      const parents = unit.parents.filter(pid => positions[pid]);
      if (!children.length || !parents.length) continue;
      const cxChildren = children.reduce((sum, cid) => sum + positions[cid].x + CARD_WIDTH / 2, 0) / children.length;
      if (parents.length >= 2) {
        const sortedParents = [...parents].sort((a, b) => positions[a].x - positions[b].x);
        const leftId = sortedParents[0];
        const rightId = sortedParents[1];
        if (!state.people[leftId].manualPosition) {
          const targetLeft = cxChildren - CARD_WIDTH - (LAYOUT.COUPLE_GAP / 2);
          maxDelta = Math.max(maxDelta, Math.abs(targetLeft - positions[leftId].x));
          positions[leftId].x = targetLeft;
        }
        if (!state.people[rightId].manualPosition) {
          const targetRight = cxChildren + (LAYOUT.COUPLE_GAP / 2);
          maxDelta = Math.max(maxDelta, Math.abs(targetRight - positions[rightId].x));
          positions[rightId].x = targetRight;
        }
      } else {
        const only = parents[0];
        if (!state.people[only].manualPosition) {
          const target = cxChildren - CARD_WIDTH / 2;
          maxDelta = Math.max(maxDelta, Math.abs(target - positions[only].x));
          positions[only].x = target;
        }
      }
    }
    for (const g of gens) resolveRowCollisions(orderByGen[g], positions);
    if (maxDelta < 1) break;
  }

  for (const id of ids) {
    const p = state.people[id];
    if (!p || !positions[id]) continue;
    p.x = positions[id].x;
    p.y = positions[id].y;
  }
  state.layoutDirty = false;
}

/* ===========================================================
   RENDER
   =========================================================== */
function render() {
  if (state.layoutDirty) computeLayout();

  const inner = $('canvasInner');
  // Remove existing person cards
  inner.querySelectorAll('.person').forEach(el => el.remove());

  const ids = state.insertionOrder.filter(id => !!state.people[id]);
  $('emptyState').style.display = ids.length ? 'none' : 'block';
  const visible = visibleIds();

  // Render cards
  for (const id of ids) {
    if (!visible.has(id)) continue;
    const p = state.people[id];
    const el = renderPersonCard(p);
    inner.appendChild(el);
  }

  // Render connections
  renderConnections();

  // Apply view transform
  applyTransform();
}

function renderPersonCard(p) {
  const el = document.createElement('div');
  el.className = 'person' + (p.deceased ? ' deceased' : '') + (state.selectedId === p.id ? ' selected' : '');
  el.dataset.id = p.id;
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';

  const fullName = displayName(p);

  const photoHtml = p.photo
    ? `<img src="${p.photo}" alt="${fullName}">`
    : `<span>${getInitials(fullName)}</span>`;

  const dates = formatDates(p);
  const place = p.birthPlace || '';

  el.innerHTML = `
    <div class="person-photo">${photoHtml}</div>
    <div class="person-name">${escapeHtml(fullName)}</div>
    ${dates ? `<div class="person-dates">${dates}</div>` : ''}
    ${place ? `<div class="person-place">${escapeHtml(place)}</div>` : ''}
    <button class="add-btn add-btn-top" data-add="parent" title="Añadir progenitor">↑<span class="add-tooltip">Añadir progenitor</span></button>
    <button class="add-btn add-btn-bottom" data-add="child" title="Añadir hijo/a">↓<span class="add-tooltip">Añadir hijo/a</span></button>
    <button class="add-btn add-btn-left" data-add="sibling" title="Añadir hermano/a">↔<span class="add-tooltip">Añadir hermano/a</span></button>
    <button class="add-btn add-btn-right" data-add="partner" title="Añadir pareja">♥<span class="add-tooltip">Añadir pareja</span></button>
  `;

  el.addEventListener('click', e => {
    if (e.target.closest('.add-btn')) {
      const rel = e.target.closest('.add-btn').dataset.add;
      handleAddRelation(p.id, rel);
      e.stopPropagation();
      return;
    }
    selectPerson(p.id);
  });

  el.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('.add-btn')) return;
    startCardDrag(p.id, e);
  });

  return el;
}

function renderConnections() {
  syncRelationsCache();
  const svg = $('connections');
  svg.innerHTML = '';
  const visible = visibleIds();
  const offsetX = 10000;
  const offsetY = 10000;
  const visibleIdsList = [...visible];
  const generation = computeGeneration(visibleIdsList);

  const drawnPartners = new Set();
  for (const [aId, bId] of Tree.getCouples()) {
    if (!visible.has(aId) || !visible.has(bId)) continue;
    const a = state.people[aId];
    const b = state.people[bId];
    if (!a || !b) continue;
    const key = [aId, bId].sort().join('|');
    if (drawnPartners.has(key)) continue;
    drawnPartners.add(key);
    const aCenter = a.x + CARD_WIDTH / 2;
    const bCenter = b.x + CARD_WIDTH / 2;
    const y = offsetY + ((a.y + b.y) / 2) + CARD_HEIGHT / 2;
    svg.appendChild(createConnectionPath([
      [offsetX + Math.min(aCenter, bCenter), y],
      [offsetX + Math.max(aCenter, bCenter), y],
    ], 'partner'));
  }

  const units = buildFamilyUnits(visibleIdsList, generation);
  for (const unit of units) {
    const children = unit.children.filter(cid => visible.has(cid) && !!state.people[cid]);
    if (!children.length) continue;
    const parents = unit.parents.filter(pid => visible.has(pid) && !!state.people[pid]);
    if (!parents.length) continue;

    const parentAnchors = parents
      .map(pid => getParentAnchor(pid, state.people))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    if (!parentAnchors.length) continue;

    const anchorX = parentAnchors.length === 1
      ? parentAnchors[0].x
      : (parentAnchors[0].x + parentAnchors[parentAnchors.length - 1].x) / 2;
    const anchorY = parentAnchors.reduce((sum, anchor) => sum + anchor.y, 0) / parentAnchors.length;

    const parentGen = Math.max(...parents.map(pid => generation[pid] ?? 0));
    const childCenters = children.map(cid => state.people[cid].x + CARD_WIDTH / 2).sort((a, b) => a - b);
    const childTopYs = children.map(cid => state.people[cid].y);
    const defaultRailY = offsetY + LAYOUT.Y_BASE + ((parentGen + 0.5) * LAYOUT.ROW_HEIGHT);
    const avgChildY = offsetY + (childTopYs.reduce((sum, y) => sum + y, 0) / childTopYs.length);
    const railY = Math.round((defaultRailY + avgChildY) / 2);

    const sx = offsetX + anchorX;
    const sy = offsetY + anchorY;
    svg.appendChild(createConnectionPath([[sx, sy], [sx, railY]]));

    const minChildX = offsetX + childCenters[0];
    const maxChildX = offsetX + childCenters[childCenters.length - 1];
    svg.appendChild(createConnectionPath([[minChildX, railY], [maxChildX, railY]]));

    for (const childId of children) {
      const child = state.people[childId];
      if (!child) continue;
      const childX = offsetX + child.x + CARD_WIDTH / 2;
      const childY = offsetY + child.y;
      svg.appendChild(createConnectionPath([[childX, railY], [childX, childY]]));
    }
  }
}

function createConnectionPath(points, className = '') {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'} ${point[0]} ${point[1]}`).join(' '));
  if (className) path.setAttribute('class', className);
  return path;
}

function applyTransform() {
  const c = $('canvas');
  c.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
  $('zoomLevel').textContent = Math.round(state.view.scale * 100) + '%';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ===========================================================
   PAN & ZOOM
   =========================================================== */
const wrap = $('canvasWrap');
let isPanning = false;
let panStart = { x: 0, y: 0, vx: 0, vy: 0 };
let dragState = null;

function startCardDrag(id, event) {
  const person = state.people[id];
  if (!person) return;
  dragState = {
    id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: person.x,
    startY: person.y,
    moved: false,
  };
  event.preventDefault();
  event.stopPropagation();
}

wrap.addEventListener('mousedown', e => {
  if (e.target.closest('.person') || e.target.closest('.zoom-controls')) return;
  isPanning = true;
  panStart = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y };
  $('canvas').classList.add('dragging');
});
window.addEventListener('mousemove', e => {
  if (dragState) {
    const person = state.people[dragState.id];
    if (!person) return;
    const dx = (e.clientX - dragState.startClientX) / state.view.scale;
    const dy = (e.clientY - dragState.startClientY) / state.view.scale;
    const x = dragState.startX + dx;
    const y = dragState.startY + dy;
    Tree.updatePerson(dragState.id, { x, y, manualPosition: { x, y } }, { pushHistory: false, affectsLayout: false });
    dragState.moved = true;
    return;
  }
  if (!isPanning) return;
  state.view.x = panStart.vx + (e.clientX - panStart.x);
  state.view.y = panStart.vy + (e.clientY - panStart.y);
  applyTransform();
});
window.addEventListener('mouseup', () => {
  if (dragState) {
    const person = state.people[dragState.id];
    if (person && dragState.moved) {
      Tree.updatePerson(dragState.id, { manualPosition: { x: person.x, y: person.y } }, { affectsLayout: false });
    }
    dragState = null;
  }
  isPanning = false;
  $('canvas').classList.remove('dragging');
});

wrap.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = -e.deltaY * 0.001;
  const newScale = Math.max(0.2, Math.min(2.5, state.view.scale * (1 + delta)));
  // Zoom toward cursor
  const rect = wrap.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const ratio = newScale / state.view.scale;
  state.view.x = cx - (cx - state.view.x) * ratio;
  state.view.y = cy - (cy - state.view.y) * ratio;
  state.view.scale = newScale;
  applyTransform();
}, { passive: false });

$('zoomIn').onclick = () => {
  state.view.scale = Math.min(2.5, state.view.scale * 1.2);
  applyTransform();
};
$('zoomOut').onclick = () => {
  state.view.scale = Math.max(0.2, state.view.scale / 1.2);
  applyTransform();
};
$('zoomReset').onclick = () => fitToScreen();

function fitToScreen() {
  const ids = [...visibleIds()];
  if (!ids.length) {
    state.view = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2, scale: 1 };
    applyTransform();
    return;
  }
  const xs = ids.map(id => state.people[id].x);
  const ys = ids.map(id => state.people[id].y);
  const minX = Math.min(...xs), maxX = Math.max(...xs) + CARD_WIDTH;
  const minY = Math.min(...ys), maxY = Math.max(...ys) + CARD_HEIGHT;
  const w = maxX - minX, h = maxY - minY;
  const padding = 80;
  const scaleX = (wrap.clientWidth - padding * 2) / w;
  const scaleY = (wrap.clientHeight - padding * 2) / h;
  const scale = Math.min(1, scaleX, scaleY);
  state.view.scale = scale;
  state.view.x = wrap.clientWidth / 2 - ((minX + maxX) / 2) * scale;
  state.view.y = wrap.clientHeight / 2 - ((minY + maxY) / 2) * scale;
  if (state.visibleFilter) {
    state.view.scale = 1;
    state.view.x = 40 - minX;
    state.view.y = 40 - minY;
  }
  applyTransform();
}

/* ===========================================================
   PANEL — Edit person
   =========================================================== */
const panel = $('panel');
let currentEditingId = null;

function selectPerson(id) {
  state.selectedId = id;
  currentEditingId = id;
  if (state.debug.highlightedChildrenByPartner && state.debug.highlightedChildrenByPartner.sourceId !== id) {
    state.debug.highlightedChildrenByPartner = null;
  }
  const p = state.people[id];
  if (!p) return;
  normalizePerson(p);

  // Fill fields
  $('panelTitle').textContent = displayName(p);
  $('fFirstName').value = p.firstName || '';
  $('fLastName1').value = p.lastName1 || '';
  $('fLastName2').value = p.lastName2 || '';
  $('fNickname').value = p.nickname || '';
  $('fGender').value = p.gender || '';
  $('fBirthDate').value = p.birthDate || '';
  $('fBirthPlace').value = p.birthPlace || '';
  $('fDeceased').checked = !!p.deceased;
  $('fDeathDate').value = p.deathDate || '';
  $('fDeathPlace').value = p.deathPlace || '';
  $('fOccupation').value = p.occupation || '';
  $('fNotes').value = p.notes || '';
  $('deathFields').style.display = p.deceased ? 'block' : 'none';

  // Photo
  updatePhotoPreview(p.photo);

  // Relations
  renderRelationsList('parentsList', getParentRelationItems(id), id, 'parent');
  renderRelationsList('partnersList', getPartners(id), id, 'partner');
  renderRelationsList('childrenList', getChildren(id), id, 'child');
  renderRelationsList('siblingsList', getSiblings(id), id, 'sibling');
  updateParentAddButtons(id);

  panel.classList.add('open');
  render();
}

function getParentRelationItems(id) {
  return parentEntries(id)
    .map(parent => ({ person: state.people[parent.id], role: parent.role }))
    .filter(item => item.person);
}

function updateParentAddButtons(id) {
  const person = state.people[id];
  if (!person) return;
  const fatherBtn = document.querySelector('.add-relation-btn[data-rel="father"]');
  const motherBtn = document.querySelector('.add-relation-btn[data-rel="mother"]');
  if (fatherBtn) {
    fatherBtn.disabled = !!person.father;
    fatherBtn.title = person.father ? 'Ya existe un padre asignado. Elimínalo o reemplázalo desde el menú del chip.' : '';
  }
  if (motherBtn) {
    motherBtn.disabled = !!person.mother;
    motherBtn.title = person.mother ? 'Ya existe una madre asignada. Elimínala o reemplázala desde el menú del chip.' : '';
  }
}

function updatePhotoPreview(photoUrl) {
  const circle = $('photoCircle');
  const placeholder = $('photoPlaceholder');
  if (photoUrl) {
    circle.innerHTML = `<img src="${photoUrl}">`;
    $('photoRemoveBtn').style.display = 'inline-flex';
  } else {
    circle.innerHTML = '';
    circle.appendChild(placeholder);
    placeholder.style.display = 'flex';
    $('photoRemoveBtn').style.display = 'none';
  }
}

function renderRelationsList(containerId, list, sourceId, relType) {
  const c = $(containerId);
  c.innerHTML = '';
  for (const item of list) {
    const rel = item.person || item;
    const role = item.role;
    const chip = document.createElement('div');
    chip.className = 'relation-chip';
    const relName = displayName(rel);
    const photoHtml = rel.photo ? `<img src="${rel.photo}">` : `<span>${getInitials(relName)}</span>`;
    const siblingKind = relType === 'sibling' ? getSiblingKind(sourceId, rel.id) : '';
    const siblingBadge = siblingKind
      ? `<span class="relation-chip-badge ${siblingKind === 'full' ? 'full-sibling' : 'half-sibling'}">${siblingKind === 'full' ? t('fullSibling') : t('halfSibling')}</span>`
      : '';
    const relationBadge = role ? `<span class="relation-chip-badge">${relationRoleLabel(role)}</span>` : '';
    chip.innerHTML = `
      <div class="relation-chip-photo">${photoHtml}</div>
      <div class="relation-chip-info">
        <div class="relation-chip-name">${escapeHtml(relName)}</div>
        <div class="relation-chip-rel">${relationBadge}${siblingBadge}${formatDates(rel) || '—'}</div>
      </div>
      <div class="relation-chip-extra"></div>
      <button class="relation-chip-remove" title="Quitar relación">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    if (relType === 'child') {
      const highlight = state.debug.highlightedChildrenByPartner;
      if (highlight && highlight.sourceId === sourceId) {
        chip.classList.add(highlight.childIds.has(rel.id) ? 'highlighted' : 'dimmed');
      }
    }
    const extra = chip.querySelector('.relation-chip-extra');
    if (relType === 'parent') {
      const roleBtn = document.createElement('button');
      roleBtn.className = 'relation-chip-action';
      roleBtn.textContent = 'Rol';
      roleBtn.title = 'Convertir rol de progenitor';
      roleBtn.onclick = e => {
        e.stopPropagation();
        openParentRoleMenu(sourceId, rel.id);
      };
      extra.appendChild(roleBtn);
    }
    if (relType === 'partner') {
      const commonBtn = document.createElement('button');
      commonBtn.className = 'relation-chip-action';
      commonBtn.textContent = 'Hijos en común';
      commonBtn.onclick = e => {
        e.stopPropagation();
        toggleCommonChildrenFilter(sourceId, rel.id);
      };
      extra.appendChild(commonBtn);
    }
    chip.querySelector('.relation-chip-info').onclick = () => selectPerson(rel.id);
    chip.querySelector('.relation-chip-photo').onclick = () => selectPerson(rel.id);
    chip.querySelector('.relation-chip-remove').onclick = (e) => {
      e.stopPropagation();
      removeRelation(sourceId, rel.id, relType);
    };
    c.appendChild(chip);
  }
}

function getCommonChildren(sourceId, partnerId) {
  const source = state.people[sourceId];
  const partner = state.people[partnerId];
  if (!source || !partner) return [];
  return Tree.getChildren(sourceId).filter(child => {
    const samePair = (child.father === sourceId && child.mother === partnerId) || (child.father === partnerId && child.mother === sourceId);
    return samePair;
  });
}

function toggleCommonChildrenFilter(sourceId, partnerId) {
  const current = state.debug.highlightedChildrenByPartner;
  if (current && current.sourceId === sourceId && current.partnerId === partnerId) {
    state.debug.highlightedChildrenByPartner = null;
  } else {
    const children = getCommonChildren(sourceId, partnerId);
    if (!children.length) {
      state.debug.highlightedChildrenByPartner = null;
      toast('No hay hijos en común para esta pareja');
    } else {
      state.debug.highlightedChildrenByPartner = {
        sourceId,
        partnerId,
        childIds: new Set(children.map(child => child.id)),
      };
    }
  }
  if (currentEditingId === sourceId) renderRelationsList('childrenList', getChildren(sourceId), sourceId, 'child');
}

function openParentRoleMenu(childId, parentId) {
  const child = state.people[childId];
  const parent = state.people[parentId];
  if (!child || !parent) return;
  showModal(`
    <div class="modal-title">Convertir rol de progenitor</div>
    <div class="modal-subtitle"><strong>${escapeHtml(displayName(parent))}</strong> respecto a <strong>${escapeHtml(displayName(child))}</strong></div>
    <div class="modal-actions" style="justify-content: stretch; flex-direction: column;">
      <button class="btn btn-primary" id="asFather">Convertir en padre</button>
      <button class="btn btn-primary" id="asMother">Convertir en madre</button>
      <button class="btn" id="asUntyped">Convertir en sin especificar</button>
      <button class="btn" id="modalCancel">Cancelar</button>
    </div>
  `);
  $('asFather').onclick = () => {
    const result = Tree.convertParentRole(childId, parentId, 'father', { confirmReplace: askReplaceParent });
    if (!result.ok && result.reason) toast(result.reason);
    closeModal();
    selectPerson(childId);
  };
  $('asMother').onclick = () => {
    const result = Tree.convertParentRole(childId, parentId, 'mother', { confirmReplace: askReplaceParent });
    if (!result.ok && result.reason) toast(result.reason);
    closeModal();
    selectPerson(childId);
  };
  $('asUntyped').onclick = () => {
    const result = Tree.convertParentRole(childId, parentId, 'untyped');
    if (!result.ok && result.reason) toast(result.reason);
    closeModal();
    selectPerson(childId);
  };
  $('modalCancel').onclick = closeModal;
}

function removeRelation(sourceId, otherId, relType) {
  if (relType === 'parent') removeParentChild(otherId, sourceId);
  else if (relType === 'child') removeParentChild(sourceId, otherId);
  else if (relType === 'partner') removePartnership(sourceId, otherId);
  else if (relType === 'sibling') {
    // Remove shared parent - just disconnect: simplest is to make them no longer share parents
    const myParents = parentEntries(sourceId).map(parent => parent.id);
    const theirParents = parentEntries(otherId).map(parent => parent.id);
    const shared = myParents.filter(p => theirParents.includes(p));
    for (const sp of shared) removeParentChild(sp, otherId);
  }
  state.layoutDirty = true;
  selectPerson(sourceId);
  toast('Relación eliminada');
}

$('panelClose').onclick = () => {
  panel.classList.remove('open');
  state.selectedId = null;
  render();
};

$('fDeceased').onchange = e => {
  $('deathFields').style.display = e.target.checked ? 'block' : 'none';
};

/* Photo upload */
$('photoUploadBtn').onclick = () => $('photoInput').click();
$('photoCircle').onclick = () => $('photoInput').click();
$('photoInput').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (currentEditingId) {
      // Resize image before storing to keep file size manageable
      resizeImage(reader.result, 400, dataUrl => {
        Tree.updatePerson(currentEditingId, { photo: dataUrl }, { affectsLayout: false });
        updatePhotoPreview(dataUrl);
      });
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};
$('photoRemoveBtn').onclick = () => {
  if (currentEditingId) {
    Tree.updatePerson(currentEditingId, { photo: null }, { affectsLayout: false });
    updatePhotoPreview('');
  }
};

function resizeImage(dataUrl, maxSize, callback) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    let w = img.width, h = img.height;
    if (w > h && w > maxSize) { h = h * (maxSize / w); w = maxSize; }
    else if (h > maxSize) { w = w * (maxSize / h); h = maxSize; }
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    callback(canvas.toDataURL('image/jpeg', 0.85));
  };
  img.src = dataUrl;
}

/* Save & delete */
$('saveBtn').onclick = () => {
  if (!currentEditingId) return;
  const result = Tree.updatePerson(currentEditingId, {
    firstName: $('fFirstName').value.trim(),
    lastName1: $('fLastName1').value.trim(),
    lastName2: $('fLastName2').value.trim(),
    nickname: $('fNickname').value.trim(),
    gender: $('fGender').value,
    birthDate: $('fBirthDate').value.trim(),
    birthPlace: $('fBirthPlace').value.trim(),
    deceased: $('fDeceased').checked,
    deathDate: $('fDeathDate').value.trim(),
    deathPlace: $('fDeathPlace').value.trim(),
    occupation: $('fOccupation').value.trim(),
    notes: $('fNotes').value.trim(),
  }, { affectsLayout: false });
  if (!result.ok) {
    toast(result.reason || 'No se pudieron guardar los cambios');
    return;
  }
  $('panelTitle').textContent = displayName(state.people[currentEditingId]);
  render();
  showSaveStatus('Guardado');
};

$('viewOptionsBtn').onclick = () => {
  if (!currentEditingId) return;
  showViewOptions(currentEditingId);
};

function applyLanguage(lang) {
  currentLang = lang === 'en' ? 'en' : 'es';
  document.documentElement.lang = currentLang;
  $('searchInput').placeholder = t('search');
  $('loadBtn').lastChild.textContent = ` ${t('load')}`;
  $('exportBtn').lastChild.textContent = ` ${t('export')}`;
  $('printBtn').lastChild.textContent = ` ${t('print')}`;
  $('helpBtn').lastChild.textContent = ` ${t('guide')}`;
  if ($('reorganizeBtn')) $('reorganizeBtn').lastChild.textContent = ` ${t('reorganize')}`;
  $('addPersonBtn').lastChild.textContent = ` ${t('addPerson')}`;
  $('deleteBtn').textContent = t('delete');
  if ($('viewOptionsBtn')) $('viewOptionsBtn').textContent = t('viewBranches');
  $('saveBtn').textContent = t('save');
  $$('#langSwitch button').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === currentLang));
  if (currentEditingId) {
    renderRelationsList('parentsList', getParentRelationItems(currentEditingId), currentEditingId, 'parent');
    renderRelationsList('partnersList', getPartners(currentEditingId), currentEditingId, 'partner');
    renderRelationsList('childrenList', getChildren(currentEditingId), currentEditingId, 'child');
    renderRelationsList('siblingsList', getSiblings(currentEditingId), currentEditingId, 'sibling');
    updateParentAddButtons(currentEditingId);
  }
}

$$('#langSwitch button').forEach(btn => {
  btn.onclick = () => applyLanguage(btn.dataset.lang);
});

$('deleteBtn').onclick = () => {
  if (!currentEditingId) return;
  const p = state.people[currentEditingId];
  if (!confirm(`¿Eliminar a ${displayName(p)}? Puedes deshacer con Ctrl+Z.`)) return;
  deletePerson(currentEditingId);
  currentEditingId = null;
  state.selectedId = null;
  panel.classList.remove('open');
  state.layoutDirty = true;
  render();
  toast('Persona eliminada');
};

/* Add relation buttons inside panel */
$$('.add-relation-btn').forEach(btn => {
  btn.onclick = () => {
    const rel = btn.dataset.rel;
    if (!currentEditingId) return;
    handleAddRelation(currentEditingId, rel);
  };
});

/* ===========================================================
   ADD RELATION FLOW
   =========================================================== */
function handleAddRelation(sourceId, relType) {
  if (relType === 'parent') {
    showParentRolePicker(sourceId);
    return;
  }
  if (relType === 'sibling') {
    const ensured = ensureSharedParentForSibling(sourceId);
    if (!ensured.ok) return;
  }
  // Show modal: option to create new person or pick existing
  const sourceName = displayName(state.people[sourceId]);
  const relLabels = {
    father: 'padre',
    mother: 'madre',
    untypedParent: 'progenitor',
    parent: 'progenitor',
    child: 'hijo/a',
    partner: 'pareja',
    sibling: 'hermano/a',
  };
  const label = relLabels[relType];

  showModal(`
    <div class="modal-title">Añadir ${label}</div>
    <div class="modal-subtitle">Para <strong>${escapeHtml(sourceName)}</strong></div>
    <div class="field-row field-row-3">
      <div class="field">
        <label>Nombre/s</label>
        <input type="text" id="newPersonFirstName" placeholder="Ej: Antonio" autofocus>
      </div>
      <div class="field">
        <label>Primer apellido</label>
        <input type="text" id="newPersonLastName1" placeholder="Ej: García">
      </div>
      <div class="field">
        <label>Segundo apellido</label>
        <input type="text" id="newPersonLastName2" placeholder="Ej: López">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Año nacim.</label>
        <input type="text" id="newPersonBirth" placeholder="aaaa">
      </div>
      <div class="field">
        <label>Año fallec.</label>
        <input type="text" id="newPersonDeath" placeholder="aaaa (opcional)">
      </div>
    </div>
    <div class="field" id="newPersonGenderField">
      <label>Sexo</label>
      <select id="newPersonGender">
        <option value="">Sin especificar</option>
        <option value="F">Femenino</option>
        <option value="M">Masculino</option>
        <option value="O">Otro</option>
      </select>
    </div>
    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line-soft); text-align: center;">
      <button class="btn" id="pickExistingBtn" style="font-size: 12px;">…o vincular con persona existente</button>
    </div>
    <div class="modal-actions">
      <button class="btn" id="modalCancel">Cancelar</button>
      <button class="btn btn-primary" id="modalCreate">Crear y vincular</button>
    </div>
  `);

  $('newPersonFirstName').focus();
  $('newPersonGender').value = genderForRelType(relType);

  $('modalCancel').onclick = closeModal;
  $('modalCreate').onclick = () => {
    const firstName = $('newPersonFirstName').value.trim();
    const lastName1 = $('newPersonLastName1').value.trim();
    const lastName2 = $('newPersonLastName2').value.trim();
    const fullName = buildFullName(firstName, lastName1, lastName2);
    if (!fullName) { $('newPersonFirstName').focus(); return; }
    const birthYear = $('newPersonBirth').value.trim();
    const deathYear = $('newPersonDeath').value.trim();
    const gender = $('newPersonGender').value;
    const newP = newPerson({
      name: fullName,
      firstName,
      lastName1,
      lastName2,
      gender,
      birthDate: birthYear,
      deceased: !!deathYear,
      deathDate: deathYear,
    });
    if (!newP) {
      toast('No se pudo crear la persona');
      return;
    }
    const linked = linkRelation(sourceId, newP.id, relType);
    if (linked === false) {
      deletePerson(newP.id);
      state.layoutDirty = true;
      render();
      return;
    }
    closeModal();
    state.layoutDirty = true;
    render();
    selectPerson(newP.id);
    toast(`${label.charAt(0).toUpperCase() + label.slice(1)} añadido/a`);
  };
  $('pickExistingBtn').onclick = () => showPersonPicker(sourceId, relType);

  // Enter to submit
  ['newPersonFirstName', 'newPersonLastName1', 'newPersonLastName2'].forEach(id => {
    $(id).onkeydown = e => { if (e.key === 'Enter') $('modalCreate').click(); };
  });
}

function showParentRolePicker(sourceId) {
  const sourceName = displayName(state.people[sourceId]);
  const person = state.people[sourceId];
  showModal(`
    <div class="modal-title">Añadir progenitor</div>
    <div class="modal-subtitle">Para <strong>${escapeHtml(sourceName)}</strong>. Puedes diferenciar padre y madre, o dejarlo sin especificar.</div>
    <div class="modal-actions" style="justify-content: stretch; flex-direction: column;">
      <button class="btn btn-primary" id="addFather" ${person?.father ? 'disabled title="Ya hay padre asignado"' : ''}>Añadir padre</button>
      <button class="btn btn-primary" id="addMother" ${person?.mother ? 'disabled title="Ya hay madre asignada"' : ''}>Añadir madre</button>
      <button class="btn" id="addParent">Añadir progenitor sin especificar</button>
      <button class="btn" id="modalCancel">Cancelar</button>
    </div>
  `);
  $('addFather').onclick = () => handleAddRelation(sourceId, 'father');
  $('addMother').onclick = () => handleAddRelation(sourceId, 'mother');
  $('addParent').onclick = () => handleAddRelation(sourceId, 'untypedParent');
  $('modalCancel').onclick = closeModal;
}

function showPersonPicker(sourceId, relType) {
  const others = Object.values(state.people).filter(p => p.id !== sourceId);
  const hint = isParentRelType(relType)
    ? 'Padre y madre son roles separados. Se permite un máximo de 2 progenitores por persona.'
    : relType === 'partner'
      ? 'Puedes añadir varias parejas a la misma persona.'
      : 'Los hermanos se autovinculan compartiendo los progenitores de la persona actual.';
  const items = others.map(p => `
    <div class="person-picker-item" data-id="${p.id}">
      <div class="relation-chip-photo">${p.photo ? `<img src="${p.photo}">` : `<span>${getInitials(displayName(p))}</span>`}</div>
      <div class="relation-chip-info">
        <div class="relation-chip-name">${escapeHtml(displayName(p))}</div>
        <div class="relation-chip-rel">${formatDates(p) || '—'}</div>
      </div>
    </div>
  `).join('');
  showModal(`
    <div class="modal-title">Vincular persona existente</div>
    <div class="modal-subtitle">Selecciona quién es ${relType === 'father' ? 'el padre' : relType === 'mother' ? 'la madre' : isParentRelType(relType) ? 'el progenitor' : relType === 'child' ? 'el hijo/a' : relType === 'partner' ? 'la pareja' : 'el hermano/a'}</div>
    <div class="person-picker-hint">${hint}</div>
    <div class="person-picker-list">${items || '<div style="padding: 20px; text-align: center; color: var(--ink-muted);">No hay otras personas en el árbol todavía.</div>'}</div>
    <div class="modal-actions">
      <button class="btn" id="modalCancel">Cancelar</button>
    </div>
  `);
  $('modalCancel').onclick = closeModal;
  $$('.person-picker-item').forEach(item => {
    item.onclick = () => {
      const linked = linkRelation(sourceId, item.dataset.id, relType);
      if (linked === false) return;
      closeModal();
      state.layoutDirty = true;
      render();
      selectPerson(sourceId);
      toast(t('linked'));
    };
  });
}

function linkRelation(sourceId, otherId, relType) {
  if (isParentRelType(relType)) return addParentChild(otherId, sourceId, relType);
  else if (relType === 'child') return addParentChild(sourceId, otherId, inferRoleFromGender(state.people[sourceId]));
  else if (relType === 'partner') return addPartnership(sourceId, otherId);
  else if (relType === 'sibling') {
    const ensured = ensureSharedParentForSibling(sourceId);
    if (!ensured.ok) return false;
    const source = state.people[sourceId];
    let linked = false;
    if (source.father) linked = Tree.setFather(otherId, source.father, { confirmReplace: askReplaceParent }).ok || linked;
    if (source.mother) linked = Tree.setMother(otherId, source.mother, { confirmReplace: askReplaceParent }).ok || linked;
    if (!linked && source.father) linked = Tree.setFather(otherId, source.father, { confirmReplace: askReplaceParent }).ok;
    if (!linked) {
      toast('No se pudo crear la hermandad por falta de progenitor común.');
      return false;
    }
    return true;
  }
  return true;
}

function ensureSharedParentForSibling(sourceId) {
  const source = state.people[sourceId];
  if (!source) return { ok: false };
  if (source.father || source.mother) return { ok: true };
  const accepted = confirm('Para que haya hermandad deben compartir al menos un progenitor. ¿Quieres crear un progenitor placeholder común ahora?');
  if (!accepted) return { ok: false };
  const placeholderResult = Tree.addParentOf(sourceId, { firstName: '', lastName1: '', lastName2: '', gender: '' }, { role: 'father' });
  if (!placeholderResult.ok) {
    toast(placeholderResult.reason || 'No se pudo crear el progenitor placeholder.');
    return { ok: false };
  }
  return { ok: true, placeholderId: placeholderResult.createdId };
}

/* ===========================================================
   MODAL HELPERS
   =========================================================== */
const modal = $('modal');
function showModal(html) {
  $('modalContent').innerHTML = html;
  modal.classList.add('open');
}
function closeModal() {
  modal.classList.remove('open');
}
modal.onclick = e => { if (e.target === modal) closeModal(); };

const GUIDE_STORAGE_KEY = 'raices-guide-dismissed-v1';

function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_STORAGE_KEY, '1');
  } catch (err) {
    console.warn('No se pudo guardar el estado de la guia', err);
  }
}

function shouldShowGuide() {
  try {
    return !localStorage.getItem(GUIDE_STORAGE_KEY);
  } catch (err) {
    console.warn('No se pudo leer el estado de la guia', err);
    return true;
  }
}

function showWelcomeModal(force = false) {
  if (!force && !shouldShowGuide()) return;
  if (!$('modalContent')) return;
  showModal(`
    <div class="guide-badge">Guia de arranque</div>
    <div class="modal-title">Asi se usa Raices</div>
    <div class="modal-subtitle">Primero plantas una persona, luego van creciendo ramas. La app empieza por una sola ficha inicial y el resto se construye desde ahi.</div>
    <div class="guide-grid">
      <div class="guide-card">
        <strong>1. Empieza por una persona</strong>
        <p>Pulsa <em>Añadir persona</em> para crear fichas. Pueden quedar sueltas y vincularse despues desde cualquier tarjeta.</p>
      </div>
      <div class="guide-card">
        <strong>2. Haz crecer relaciones</strong>
        <p>Usa los botones alrededor de la tarjeta: arriba progenitores, abajo hijos, izquierda hermanos y derecha parejas. En el panel puedes elegir padre o madre.</p>
      </div>
      <div class="guide-card">
        <strong>3. Completa la historia</strong>
        <p>Selecciona cualquier persona para editar fechas, lugares, notas, ocupacion y foto desde el panel lateral.</p>
      </div>
      <div class="guide-card">
        <strong>4. Guarda, mira e imprime</strong>
        <p>Exporta JSON para conservar fotos, usa doble clic para alternar rama directa/arbol completo e imprime todo, rama o epoca.</p>
      </div>
    </div>
    <div class="guide-tip">Consejo: si quieres volver a ver esta ayuda, pulsa <strong>Guía</strong> en la barra superior.</div>
    <div class="modal-actions">
      <button class="btn" id="guideHide">No volver a mostrar</button>
      <button class="btn btn-primary" id="guideStart">Empezar a ramificar</button>
    </div>
  `);
  $('guideHide').onclick = () => {
    markGuideSeen();
    closeModal();
  };
  $('guideStart').onclick = () => {
    markGuideSeen();
    closeModal();
  };
}

function showViewOptions(sourceId) {
  const sourceName = displayName(state.people[sourceId]);
  showModal(`
    <div class="modal-title">Ver ramas</div>
    <div class="modal-subtitle">Elige cómo quieres ver el árbol tomando como referencia a <strong>${escapeHtml(sourceName)}</strong>. También puedes abrir este selector con doble clic sobre una tarjeta.</div>
    <div class="modal-actions" style="justify-content: stretch; flex-direction: column;">
      <button class="btn btn-primary" id="viewDirect">Ver rama directa</button>
      <button class="btn" id="viewAll">Ver árbol completo</button>
      <button class="btn" id="modalCancel">Cancelar</button>
    </div>
  `);
  $('viewDirect').onclick = () => {
    state.viewMode = 'direct';
    state.focusId = sourceId;
    closeModal();
    state.layoutDirty = true;
    render();
    fitToScreen();
    toast('Mostrando rama directa');
  };
  $('viewAll').onclick = () => {
    state.viewMode = 'all';
    state.focusId = null;
    closeModal();
    state.layoutDirty = true;
    render();
    fitToScreen();
    toast('Mostrando árbol completo');
  };
  $('modalCancel').onclick = closeModal;
}

wrap.addEventListener('dblclick', e => {
  const card = e.target.closest('.person');
  if (!card) return;
  showViewOptions(card.dataset.id);
});

/* ===========================================================
   ADD PERSON BUTTON (top bar)
   =========================================================== */
function createFirstPerson() {
  showModal(`
    <div class="modal-title">Nueva persona</div>
    <div class="modal-subtitle">Crea una persona suelta. Podrás vincularla después desde cualquier tarjeta o desde su panel.</div>
    <div class="field-row field-row-3">
      <div class="field">
        <label>Nombre/s</label>
        <input type="text" id="newPersonFirstName" placeholder="Ej: Antonio" autofocus>
      </div>
      <div class="field">
        <label>Primer apellido</label>
        <input type="text" id="newPersonLastName1" placeholder="Ej: García">
      </div>
      <div class="field">
        <label>Segundo apellido</label>
        <input type="text" id="newPersonLastName2" placeholder="Ej: López">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Año nacim.</label>
        <input type="text" id="newPersonBirth" placeholder="aaaa">
      </div>
      <div class="field">
        <label>Año fallec.</label>
        <input type="text" id="newPersonDeath" placeholder="aaaa (opcional)">
      </div>
    </div>
    <div class="field">
      <label>Sexo</label>
      <select id="newPersonGender">
        <option value="">Sin especificar</option>
        <option value="F">Femenino</option>
        <option value="M">Masculino</option>
        <option value="O">Otro</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" id="modalCancel">Cancelar</button>
      <button class="btn btn-primary" id="modalCreate">Crear</button>
    </div>
  `);
  $('newPersonFirstName').focus();
  $('modalCancel').onclick = closeModal;
  $('modalCreate').onclick = () => {
    const firstName = $('newPersonFirstName').value.trim();
    const lastName1 = $('newPersonLastName1').value.trim();
    const lastName2 = $('newPersonLastName2').value.trim();
    const fullName = buildFullName(firstName, lastName1, lastName2);
    if (!fullName) {
      $('newPersonFirstName').focus();
      return;
    }
    const birthYear = $('newPersonBirth').value.trim();
    const deathYear = $('newPersonDeath').value.trim();
    const gender = $('newPersonGender').value;
    const p = newPerson({
      name: fullName,
      firstName,
      lastName1,
      lastName2,
      gender,
      birthDate: birthYear,
      deceased: !!deathYear, deathDate: deathYear
    });
    if (!p) {
      toast('No se pudo crear la persona');
      return;
    }
    closeModal();
    state.layoutDirty = true;
    render();
    fitToScreen();
    selectPerson(p.id);
  };
  ['newPersonFirstName', 'newPersonLastName1', 'newPersonLastName2'].forEach(id => {
    $(id).onkeydown = e => { if (e.key === 'Enter') $('modalCreate').click(); };
  });
}

$('addPersonBtn').onclick = createFirstPerson;
$('emptyAddBtn').onclick = createFirstPerson;
$('helpBtn').onclick = () => showWelcomeModal(true);
if ($('reorganizeBtn')) {
  $('reorganizeBtn').onclick = () => {
    const result = Tree.clearManualPositions();
    if (result.ok) {
      fitToScreen();
      toast('Layout reorganizado automáticamente');
    }
  };
}

/* ===========================================================
   SEARCH
   =========================================================== */
$('searchInput').oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  const results = $('searchResults');
  if (!q) { results.classList.remove('open'); return; }
  const matches = Object.values(state.people).filter(p =>
    displayName(p).toLowerCase().includes(q) ||
    (p.nickname && p.nickname.toLowerCase().includes(q)) ||
    (p.birthPlace && p.birthPlace.toLowerCase().includes(q))
  ).slice(0, 8);
  if (!matches.length) {
    results.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--ink-muted); font-size: 12px;">Sin resultados</div>';
  } else {
    results.innerHTML = matches.map(p => `
      <div class="search-result" data-id="${p.id}">
        <div class="search-result-photo">${p.photo ? `<img src="${p.photo}">` : `<span>${getInitials(displayName(p))}</span>`}</div>
        <div>
          <div class="search-result-name">${escapeHtml(displayName(p))}</div>
          <div class="search-result-dates">${formatDates(p) || ''}</div>
        </div>
      </div>
    `).join('');
    results.querySelectorAll('.search-result').forEach(r => {
      r.onclick = () => {
        const id = r.dataset.id;
        const p = state.people[id];
        // Center on person
        state.view.scale = 1;
        state.view.x = wrap.clientWidth / 2 - (p.x + CARD_WIDTH / 2);
        state.view.y = wrap.clientHeight / 2 - (p.y + CARD_HEIGHT / 2);
        applyTransform();
        selectPerson(id);
        $('searchInput').value = '';
        results.classList.remove('open');
      };
    });
  }
  results.classList.add('open');
};
document.addEventListener('click', e => {
  if (!e.target.closest('.search-box')) $('searchResults').classList.remove('open');
});

/* ===========================================================
   EXPORT — JSON & EXCEL
   =========================================================== */
$('exportBtn').onclick = e => {
  e.stopPropagation();
  toggleMenu('exportMenu');
};
$('printBtn').onclick = e => {
  e.stopPropagation();
  toggleMenu('printMenu');
};
function toggleMenu(id) {
  const menu = $(id);
  const isOpen = menu.classList.contains('open');
  $$('.menu').forEach(m => m.classList.remove('open'));
  if (!isOpen) {
    menu.classList.add('open');
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest('.menu') && !e.target.closest('#exportBtn') && !e.target.closest('#printBtn')) {
    $$('.menu').forEach(m => m.classList.remove('open'));
  }
});

$$('#exportMenu .menu-item').forEach(item => {
  item.onclick = () => {
    const fmt = item.dataset.export;
    if (fmt === 'json') exportJSON();
    if (fmt === 'excel') exportExcel();
    $('exportMenu').classList.remove('open');
  };
});

function exportJSON() {
  const people = {};
  for (const id of state.insertionOrder) {
    const p = state.people[id];
    if (!p) continue;
    people[id] = {
      id: p.id,
      firstName: p.firstName,
      lastName1: p.lastName1,
      lastName2: p.lastName2,
      name: p.name,
      nickname: p.nickname,
      gender: p.gender,
      birthDate: p.birthDate,
      birthPlace: p.birthPlace,
      deceased: p.deceased,
      deathDate: p.deathDate,
      deathPlace: p.deathPlace,
      occupation: p.occupation,
      notes: p.notes,
      photo: p.photo,
      father: p.father,
      mother: p.mother,
      untypedParents: [...p.untypedParents],
      partners: [...p.partners],
      manualPosition: p.manualPosition ? { ...p.manualPosition } : null,
      _order: personOrderIndex(id),
    };
  }
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    people,
    insertionOrder: [...state.insertionOrder],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  download(blob, `arbol-genealogico-${dateStamp()}.json`);
  toast(t('jsonDownloaded'));
}

function exportExcel() {
  syncRelationsCache();
  const wb = XLSX.utils.book_new();

  // Sheet 1: People
  const peopleRows = [['ID', 'Nombre', 'Primer apellido', 'Segundo apellido', 'Nombre completo', 'Apodo', 'Sexo', 'Fecha nacimiento', 'Lugar nacimiento', 'Fallecido', 'Fecha fallecimiento', 'Lugar fallecimiento', 'Profesión', 'Notas', 'Father', 'Mother', 'UntypedParents', 'Partners', 'ManualX', 'ManualY']];
  for (const id of state.insertionOrder) {
    const p = state.people[id];
    if (!p) continue;
    normalizePerson(p);
    peopleRows.push([
      p.id, p.firstName || '', p.lastName1 || '', p.lastName2 || '', displayName(p), p.nickname || '', p.gender || '',
      p.birthDate || '', p.birthPlace || '',
      p.deceased ? 'Sí' : 'No',
      p.deathDate || '', p.deathPlace || '',
      p.occupation || '', p.notes || '',
      p.father || '',
      p.mother || '',
      (p.untypedParents || []).join('|'),
      (p.partners || []).join('|'),
      p.manualPosition?.x ?? '',
      p.manualPosition?.y ?? '',
    ]);
  }
  const wsPeople = XLSX.utils.aoa_to_sheet(peopleRows);
  wsPeople['!cols'] = [{ wch: 8 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 15 }, { wch: 8 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 16 }, { wch: 22 }, { wch: 20 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 24 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsPeople, 'Personas');

  // Sheet 2: Parent-child
  const parentRows = [['ID Hijo', 'Nombre Hijo', 'ID Padre/Madre', 'Nombre Padre/Madre', 'Rol']];
  for (const [cid, parents] of Object.entries(state.relations.parents)) {
    for (const parent of parents.map(normalizeParentEntry).filter(Boolean)) {
      parentRows.push([cid, displayName(state.people[cid]), parent.id, displayName(state.people[parent.id]), relationRoleLabel(parent.role)]);
    }
  }
  const wsParents = XLSX.utils.aoa_to_sheet(parentRows);
  wsParents['!cols'] = [{ wch: 10 }, { wch: 25 }, { wch: 15 }, { wch: 25 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsParents, 'Padres-Hijos');

  // Sheet 3: Partners
  const partnerRows = [['ID Persona A', 'Nombre A', 'ID Persona B', 'Nombre B']];
  const seen = new Set();
  for (const [aId, partners] of Object.entries(state.relations.partners)) {
    for (const bId of partners) {
      const key = [aId, bId].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      partnerRows.push([aId, displayName(state.people[aId]), bId, displayName(state.people[bId])]);
    }
  }
  const wsPartners = XLSX.utils.aoa_to_sheet(partnerRows);
  wsPartners['!cols'] = [{ wch: 12 }, { wch: 25 }, { wch: 12 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsPartners, 'Parejas');

  // Sheet 4: Notes
  const infoRows = [
    ['Raíces - Árbol Genealógico'],
    ['Exportado:', new Date().toLocaleString('es-ES')],
    ['Personas:', Object.keys(state.people).length],
    [],
    ['Nota: Este Excel contiene los datos en formato legible.'],
    ['Para preservar las fotos y poder editar el árbol, usa también el archivo JSON.'],
    ['Puedes editar este Excel y volver a cargarlo, las fotos se mantendrán si subes ambos archivos.'],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Info');

  XLSX.writeFile(wb, `arbol-genealogico-${dateStamp()}.xlsx`);
  toast(t('excelDownloaded'));
}

function dateStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===========================================================
   IMPORT
   =========================================================== */
$('loadBtn').onclick = () => $('loadInput').click();
$('loadInput').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'json') importJSON(file);
  else if (ext === 'xlsx' || ext === 'xls') importExcel(file);
  else toast('Formato no soportado');
  e.target.value = '';
};

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const rawPeople = data.people || data.personas || (Array.isArray(data) ? data : null);
      if (!rawPeople) throw new Error('Archivo inválido');
      applyImportedState({
        people: rawPeople,
        relations: data.relations || {},
        insertionOrder: data.insertionOrder || [],
      });
    } catch (err) {
      toast('Error al cargar el archivo');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function applyImportedState(raw) {
  const sanitized = Tree.sanitize(raw);
  state.people = sanitized.state.people;
  state.insertionOrder = sanitized.state.insertionOrder.length
    ? sanitized.state.insertionOrder
    : Object.keys(state.people).sort((a, b) => (state.people[a]._order ?? 0) - (state.people[b]._order ?? 0));
  Object.values(state.people).forEach(normalizePerson);
  state.selectedId = null;
  currentEditingId = null;
  state.viewMode = 'all';
  state.focusId = null;
  state.visibleFilter = null;
  state.undoStack = [];
  state.redoStack = [];
  state.debug.highlightedChildrenByPartner = null;
  panel.classList.remove('open');
  invalidateDerived();
  state.layoutDirty = true;
  render();
  fitToScreen();
  const loadedMsg = t('loaded', Object.keys(state.people).length);
  if (sanitized.fixes.length) toast(`${loadedMsg} · ${t('correctedInconsistencies', sanitized.fixes.length)}`);
  else toast(loadedMsg);
}

function importExcel(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = new Uint8Array(reader.result);
      const wb = XLSX.read(data, { type: 'array' });

      const people = {};
      const relations = { parents: {}, partners: {} };

      // People sheet
      const peopleSheet = wb.Sheets['Personas'] || wb.Sheets[wb.SheetNames[0]];
      if (peopleSheet) {
        const rows = XLSX.utils.sheet_to_json(peopleSheet, { header: 1 });
        const headers = rows[0] || [];
        const idx = (name) => headers.findIndex(h => String(h).toLowerCase().includes(name.toLowerCase()));
        const cols = {
          id: idx('id'),
          firstName: idx('nombre/s') !== -1 ? idx('nombre/s') : idx('nombre'),
          lastName1: idx('primer apellido'),
          lastName2: idx('segundo apellido'),
          fullName: idx('nombre completo'),
          nickname: idx('apodo'),
          gender: idx('sexo'),
          birthDate: idx('fecha nacimiento'),
          birthPlace: idx('lugar nacimiento'),
          deceased: idx('fallecido'),
          deathDate: idx('fecha falleci'),
          deathPlace: idx('lugar falleci'),
          occupation: idx('profesión') !== -1 ? idx('profesión') : idx('profesion'),
          notes: idx('notas'),
          father: idx('father'),
          mother: idx('mother'),
          untypedParents: idx('untypedparents'),
          partners: idx('partners'),
          manualX: idx('manualx'),
          manualY: idx('manualy'),
        };
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row.length) continue;
          const id = String(row[cols.id] || ('p' + i));
          people[id] = {
            id,
            name: String((cols.fullName !== -1 ? row[cols.fullName] : '') || (cols.firstName !== -1 ? row[cols.firstName] : '') || 'Sin nombre'),
            firstName: String(cols.firstName !== -1 ? (row[cols.firstName] || '') : ''),
            lastName1: String(cols.lastName1 !== -1 ? (row[cols.lastName1] || '') : ''),
            lastName2: String(cols.lastName2 !== -1 ? (row[cols.lastName2] || '') : ''),
            nickname: String(row[cols.nickname] || ''),
            gender: String(row[cols.gender] || ''),
            birthDate: String(row[cols.birthDate] || ''),
            birthPlace: String(row[cols.birthPlace] || ''),
            deceased: String(row[cols.deceased] || '').toLowerCase().startsWith('s'),
            deathDate: String(row[cols.deathDate] || ''),
            deathPlace: String(row[cols.deathPlace] || ''),
            occupation: String(row[cols.occupation] || ''),
            notes: String(row[cols.notes] || ''),
            photo: null,
            father: cols.father !== -1 ? String(row[cols.father] || '') || null : null,
            mother: cols.mother !== -1 ? String(row[cols.mother] || '') || null : null,
            untypedParents: cols.untypedParents !== -1 ? String(row[cols.untypedParents] || '').split('|').map(v => v.trim()).filter(Boolean) : [],
            partners: cols.partners !== -1 ? String(row[cols.partners] || '').split('|').map(v => v.trim()).filter(Boolean) : [],
            manualPosition: (cols.manualX !== -1 && cols.manualY !== -1 && row[cols.manualX] !== undefined && row[cols.manualY] !== undefined)
              ? { x: Number(row[cols.manualX]), y: Number(row[cols.manualY]) }
              : null,
          };
          normalizePerson(people[id]);
        }
      }

      // Parent-child sheet
      const parentSheet = wb.Sheets['Padres-Hijos'];
      if (parentSheet) {
        const rows = XLSX.utils.sheet_to_json(parentSheet, { header: 1 });
        const headers = rows[0] || [];
        const roleCol = headers.findIndex(h => String(h).toLowerCase().includes('rol'));
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length < 3) continue;
          const childId = String(r[0]);
          const parentId = String(r[2]);
          const roleValue = roleCol !== -1 ? String(r[roleCol] || '').toLowerCase() : '';
          const role = roleValue === 'padre' ? 'father' : roleValue === 'madre' ? 'mother' : inferRoleFromGender(people[parentId]);
          if (people[childId] && people[parentId]) {
            if (!relations.parents[childId]) relations.parents[childId] = [];
            if (!relations.parents[childId].some(parent => parent.id === parentId) && relations.parents[childId].length < 2) {
              relations.parents[childId].push({ id: parentId, role });
            }
          }
        }
      }

      // Partners sheet
      const partnerSheet = wb.Sheets['Parejas'];
      if (partnerSheet) {
        const rows = XLSX.utils.sheet_to_json(partnerSheet, { header: 1 });
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length < 3) continue;
          const aId = String(r[0]);
          const bId = String(r[2]);
          if (people[aId] && people[bId]) {
            if (!relations.partners[aId]) relations.partners[aId] = [];
            if (!relations.partners[bId]) relations.partners[bId] = [];
            if (!relations.partners[aId].includes(bId)) relations.partners[aId].push(bId);
            if (!relations.partners[bId].includes(aId)) relations.partners[bId].push(aId);
          }
        }
      }

      applyImportedState({ people, relations });
    } catch (err) {
      toast('Error al cargar Excel');
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ===========================================================
   PRINT
   =========================================================== */
$$('#printMenu .menu-item').forEach(item => {
  item.onclick = () => {
    const mode = item.dataset.print;
    $('printMenu').classList.remove('open');
    if (mode === 'all') {
      printAll();
    } else if (mode === 'selected') {
      if (!state.selectedId) { toast('Selecciona una persona primero'); return; }
      printDirectBranch(state.selectedId);
    } else if (mode === 'descendants') {
      if (!state.selectedId) { toast('Selecciona una persona primero'); return; }
      printDescendants(state.selectedId);
    } else if (mode === 'filter') {
      promptYearFilter();
    }
  };
});

function printDirectBranch(rootId) {
  printWithFilter(getDirectBranchIds(rootId));
}

function printAll() {
  printWithFilter(new Set(Object.keys(state.people)));
}

function printDescendants(rootId) {
  // Hide all people not in descendant tree, then print, then restore
  const keep = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    const kids = getChildren(id).map(k => k.id);
    const partners = getPartners(id).map(p => p.id);
    for (const k of kids) if (!keep.has(k)) { keep.add(k); queue.push(k); }
    for (const p of partners) if (!keep.has(p)) keep.add(p);
  }
  printWithFilter(keep);
}

function promptYearFilter() {
  showModal(`
    <div class="modal-title">Imprimir por época</div>
    <div class="modal-subtitle">Mostrar solo las personas que estaban vivas en un año determinado.</div>
    <div class="field">
      <label>Año</label>
      <input type="number" id="filterYear" placeholder="Ej: 1900" autofocus>
    </div>
    <div class="modal-actions">
      <button class="btn" id="modalCancel">Cancelar</button>
      <button class="btn btn-primary" id="modalConfirm">Imprimir</button>
    </div>
  `);
  $('filterYear').focus();
  $('modalCancel').onclick = closeModal;
  $('modalConfirm').onclick = () => {
    const year = parseInt($('filterYear').value, 10);
    if (!year) return;
    closeModal();
    const keep = new Set();
    for (const p of Object.values(state.people)) {
      const birth = parseInt(extractYear(p.birthDate), 10);
      const death = parseInt(extractYear(p.deathDate), 10);
      const alive = (!birth || birth <= year) && (!p.deceased || !death || death >= year);
      if (alive && (birth || !p.deceased)) keep.add(p.id);
    }
    if (!keep.size) { toast('No hay personas con datos suficientes'); return; }
    printWithFilter(keep);
  };
}

function printWithFilter(keepSet) {
  const previousView = state.viewMode;
  const previousFocus = state.focusId;
  const previousTransform = { ...state.view };
  const inner = $('canvasInner');
  const previousSize = { width: inner.style.width, height: inner.style.height };
  state.visibleFilter = keepSet;
  state.layoutDirty = true;
  render();
  fitToScreen();
  preparePrintCanvas(keepSet);
  const hidden = hideOutsidePrintSet(keepSet);
  const restore = () => {
    hidden.forEach(c => c.style.display = '');
    inner.style.width = previousSize.width;
    inner.style.height = previousSize.height;
    state.visibleFilter = null;
    state.viewMode = previousView;
    state.focusId = previousFocus;
    state.view = previousTransform;
    state.layoutDirty = true;
    render();
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
  setTimeout(() => {
    if (state.visibleFilter) restore();
  }, 1000);
}

function preparePrintCanvas(keepSet) {
  const ids = [...keepSet].filter(id => state.people[id]);
  if (!ids.length) return;
  const minX = Math.min(...ids.map(id => state.people[id].x));
  const minY = Math.min(...ids.map(id => state.people[id].y));
  const maxX = Math.max(...ids.map(id => state.people[id].x + CARD_WIDTH));
  const maxY = Math.max(...ids.map(id => state.people[id].y + CARD_HEIGHT));
  const inner = $('canvasInner');
  inner.style.width = (maxX - minX + 80) + 'px';
  inner.style.height = (maxY - minY + 80) + 'px';
}

function hideOutsidePrintSet(keepSet) {
  const cards = document.querySelectorAll('.person');
  const hidden = [];
  cards.forEach(c => {
    if (!keepSet.has(c.dataset.id)) {
      hidden.push(c);
      c.style.display = 'none';
    }
  });
  return hidden;
}

/* ===========================================================
   DEBUG TESTS (?debug=1)
   =========================================================== */
function canonicalPeopleForComparison(peopleMap) {
  const out = {};
  const ids = Object.keys(peopleMap).sort();
  for (const id of ids) {
    const p = normalizePerson({ ...peopleMap[id] }, { preserveRuntime: false });
    out[id] = {
      id: p.id,
      firstName: p.firstName,
      lastName1: p.lastName1,
      lastName2: p.lastName2,
      nickname: p.nickname,
      gender: p.gender,
      birthDate: p.birthDate,
      birthPlace: p.birthPlace,
      deceased: p.deceased,
      deathDate: p.deathDate,
      deathPlace: p.deathPlace,
      occupation: p.occupation,
      notes: p.notes,
      photo: p.photo,
      father: p.father,
      mother: p.mother,
      untypedParents: [...p.untypedParents].sort(),
      partners: [...p.partners].sort(),
      manualPosition: p.manualPosition ? { ...p.manualPosition } : null,
    };
  }
  return out;
}

function runDebugTests() {
  syncRelationsCache();
  const ids = state.insertionOrder.filter(id => !!state.people[id]);
  const generation = computeGeneration(ids);
  const byGen = mapByGeneration(ids, generation);
  const testResults = [];

  const add = (id, description, pass) => testResults.push({ id, description, pass: !!pass });

  add('T1', 'Campos father/mother no son arrays', ids.every(id => !Array.isArray(state.people[id].father) && !Array.isArray(state.people[id].mother)));
  add('T2', 'father apunta a persona existente', ids.every(id => !state.people[id].father || !!state.people[state.people[id].father]));
  add('T3', 'mother apunta a persona existente', ids.every(id => !state.people[id].mother || !!state.people[state.people[id].mother]));
  add('T4', 'Parejas simétricas', ids.every(id => state.people[id].partners.every(pid => state.people[pid] && state.people[pid].partners.includes(id))));
  add('T5', 'Sin autociclos de ancestros', ids.every(id => !Tree.getAncestors(id).has(id)));
  add('T6', 'Hermanos UI comparten father o mother', ids.every(id => getSiblings(id).every(s => (!!state.people[id].father && s.father === state.people[id].father) || (!!state.people[id].mother && s.mother === state.people[id].mother))));
  add('T7', 'getSiblings no devuelve espurios', ids.every(id => Tree.getSiblings(id).every(s => s.id !== id && ((state.people[id].father && s.father === state.people[id].father) || (state.people[id].mother && s.mother === state.people[id].mother)))));
  const once = Tree.sanitize({ people: deepClone(state.people), relations: deepClone(state.relations) });
  const twice = Tree.sanitize({ people: deepClone(once.state.people), relations: {} });
  add('T8', 'sanitize idempotente', JSON.stringify(canonicalPeopleForComparison(once.state.people)) === JSON.stringify(canonicalPeopleForComparison(twice.state.people)));

  // L1: full siblings contiguous (except manual)
  let l1Pass = true;
  for (const [g, row] of Object.entries(byGen)) {
    const sorted = [...row].sort((a, b) => state.people[a].x - state.people[b].x);
    const groupMap = {};
    for (const id of sorted) {
      const p = state.people[id];
      if (p.manualPosition || !p.father || !p.mother) continue;
      const key = `${g}|${p.father}|${p.mother}`;
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(id);
    }
    for (const siblings of Object.values(groupMap)) {
      if (siblings.length < 2) continue;
      const idxs = siblings.map(id => sorted.indexOf(id)).sort((a, b) => a - b);
      for (let i = 1; i < idxs.length; i++) {
        if (idxs[i] !== idxs[i - 1] + 1) l1Pass = false;
      }
    }
  }
  add('L1', 'Hermanos completos adyacentes (salvo manual)', l1Pass);

  // L2: parents centered over children
  const units = buildFamilyUnits(ids, generation);
  let l2Pass = true;
  for (const unit of units) {
    const children = unit.children.map(id => state.people[id]).filter(Boolean);
    const parents = unit.parents.map(id => state.people[id]).filter(Boolean);
    if (!children.length || !parents.length) continue;
    const cxChildren = children.reduce((sum, p) => sum + p.x + CARD_WIDTH / 2, 0) / children.length;
    const parentMin = Math.min(...parents.map(p => p.x + CARD_WIDTH / 2));
    const parentMax = Math.max(...parents.map(p => p.x + CARD_WIDTH / 2));
    if (cxChildren < parentMin - LAYOUT.MIN_GAP || cxChildren > parentMax + LAYOUT.MIN_GAP) l2Pass = false;
  }
  add('L2', 'Progenitores centrados respecto a hijos', l2Pass);

  // L3: no overlap same generation
  let l3Pass = true;
  for (const row of Object.values(byGen)) {
    const sorted = [...row].sort((a, b) => state.people[a].x - state.people[b].x);
    for (let i = 1; i < sorted.length; i++) {
      const dx = Math.abs(state.people[sorted[i]].x - state.people[sorted[i - 1]].x);
      if (dx < CARD_WIDTH + LAYOUT.MIN_GAP) l3Pass = false;
    }
  }
  add('L3', 'Sin solapamiento por generación', l3Pass);

  // L4: couples adjacent (same generation, unless manual)
  let l4Pass = true;
  for (const [aId, bId] of Tree.getCouples()) {
    if ((generation[aId] ?? -1) !== (generation[bId] ?? -1)) continue;
    if (state.people[aId]?.manualPosition || state.people[bId]?.manualPosition) continue;
    const row = [...(byGen[generation[aId]] || [])].sort((a, b) => state.people[a].x - state.people[b].x);
    const ia = row.indexOf(aId);
    const ib = row.indexOf(bId);
    if (ia !== -1 && ib !== -1 && Math.abs(ia - ib) !== 1) l4Pass = false;
  }
  add('L4', 'Parejas adyacentes en la misma generación', l4Pass);

  // L5: generation vertical separation
  let l5Pass = true;
  for (const id of ids) {
    const g = generation[id] ?? 0;
    for (const otherId of ids) {
      if ((generation[otherId] ?? 0) !== g + 1) continue;
      if (!(state.people[otherId].y > state.people[id].y + CARD_HEIGHT)) l5Pass = false;
    }
  }
  add('L5', 'Generaciones separadas en Y', l5Pass);

  state.debug.lastResults = testResults;
  state.debug.failCount = testResults.filter(result => !result.pass).length;
  renderDebugPanel();
}

function renderDebugPanel() {
  const panel = $('debugPanel');
  if (!panel) return;
  const results = state.debug.lastResults || [];
  const listHtml = results.map(result => `
    <div class="debug-test-line ${result.pass ? 'pass' : 'fail'}">
      <span>${result.id} · ${result.description}</span>
      <strong>${result.pass ? 'OK' : 'FAIL'}</strong>
    </div>
  `).join('');
  panel.querySelector('.debug-results').innerHTML = listHtml || '<div style="color: var(--ink-muted)">Sin ejecución todavía.</div>';
  let banner = $('debugFailBanner');
  if (state.debug.failCount > 0) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'debugFailBanner';
      banner.className = 'debug-banner-fail';
      document.body.appendChild(banner);
    }
    banner.textContent = `Debug: ${state.debug.failCount} test(s) en fallo`;
  } else if (banner) {
    banner.remove();
  }
}

function loadDebugSampleData() {
  const people = {
    abuelo: { id: 'abuelo', firstName: 'Carlos', lastName1: 'Ruiz', gender: 'M', partners: ['ab1', 'ab2'] },
    ab1: { id: 'ab1', firstName: 'Ana', lastName1: 'Mora', gender: 'F', partners: ['abuelo'] },
    ab2: { id: 'ab2', firstName: 'Elena', lastName1: 'Paz', gender: 'F', partners: ['abuelo'] },
    h1: { id: 'h1', firstName: 'Luis', father: 'abuelo', mother: 'ab1' },
    h2: { id: 'h2', firstName: 'Nora', father: 'abuelo', mother: 'ab1' },
    h3: { id: 'h3', firstName: 'Raul', father: 'abuelo', mother: 'ab1' },
    h4: { id: 'h4', firstName: 'Sonia', father: 'abuelo', mother: 'ab2' },
    h5: { id: 'h5', firstName: 'Tomas', father: 'abuelo', mother: 'ab2' },
    soloP: { id: 'soloP', firstName: 'PadreSolo', gender: 'M' },
    cSolo: { id: 'cSolo', firstName: 'HijaSolo', father: 'soloP' },
    pA: { id: 'pA', firstName: 'Mario', gender: 'M', partners: ['pB'] },
    pB: { id: 'pB', firstName: 'Lidia', gender: 'F', partners: ['pA'] },
    gem1: { id: 'gem1', firstName: 'Gema', father: 'pA', mother: 'pB', birthDate: '2010' },
    gem2: { id: 'gem2', firstName: 'Luna', father: 'pA', mother: 'pB', birthDate: '2010' },
  };
  applyImportedState({ people });
  runDebugTests();
}

function initDebugPanel() {
  if (!state.debug.enabled) return;
  const panelEl = document.createElement('div');
  panelEl.id = 'debugPanel';
  panelEl.className = 'debug-panel';
  panelEl.innerHTML = `
    <h4>Debug tests</h4>
    <div style="display:flex; gap:6px; margin-bottom:8px;">
      <button class="btn" id="runDebugTestsBtn" style="font-size:11px; padding:6px 10px;">Ejecutar tests</button>
      <button class="btn" id="loadDebugDataBtn" style="font-size:11px; padding:6px 10px;">Cargar ejemplo de prueba</button>
    </div>
    <div class="debug-results"></div>
  `;
  document.body.appendChild(panelEl);
  $('runDebugTestsBtn').onclick = runDebugTests;
  $('loadDebugDataBtn').onclick = loadDebugSampleData;
  runDebugTests();
}

/* ===========================================================
   TOAST
   =========================================================== */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}


/* ===========================================================
   AUTO-SAVE / LOCALSTORAGE
   =========================================================== */
const STORAGE_KEY = 'familytree_raices_data';
const STORAGE_META = 'familytree_raices_meta';
let autoSaveTimer = null;
const AUTOSAVE_DELAY = 2000; // ms

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(doAutoSave, AUTOSAVE_DELAY);
}

function doAutoSave() {
  try {
    const data = {
      people: deepClone(state.people),
      insertionOrder: [...state.insertionOrder],
      selectedId: state.selectedId,
      viewMode: state.viewMode,
      focusId: state.focusId,
      view: { ...state.view },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(STORAGE_META, JSON.stringify({
      savedAt: new Date().toISOString(),
      count: state.insertionOrder.filter(id => !!state.people[id]).length,
    }));
    showSaveStatus('Guardado');
  } catch (e) {
    console.warn('Auto-save failed:', e);
    showSaveStatus('Error al guardar');
  }
}

function loadAutoSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.people || !Object.keys(data.people).length) return false;
    const result = Tree.sanitize({ people: data.people, insertionOrder: data.insertionOrder || [] });
    applyImportedState(result.state);
    if (data.selectedId && state.people[data.selectedId]) {
      state.selectedId = data.selectedId;
      state.viewMode = data.viewMode || 'all';
      state.focusId = data.focusId || null;
      if (data.view) state.view = data.view;
    }
    return true;
  } catch (e) {
    console.warn('Auto-load failed:', e);
    return false;
  }
}

function showSaveStatus(msg) {
  const el = $('saveStatus');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.textContent = ''; }, 300);
  }, 2000);
}

/* ===========================================================
   SHARE URL (hash encode)
   =========================================================== */
function shareTreeUrl() {
  try {
    const data = {
      people: deepClone(state.people),
      insertionOrder: [...state.insertionOrder],
    };
    const json = JSON.stringify(data);
    // Compress with LZ-String-like approach using TextEncoder + pako would be ideal
    // For now, use btoa with UTF-8 encoding
    const utf8 = unescape(encodeURIComponent(json));
    const encoded = btoa(utf8);
    // Truncate if too long for URL (max ~2000 chars for safe sharing)
    const maxLen = 1500;
    let shortUrl = window.location.origin + window.location.pathname + '#' + encoded;
    if (encoded.length > maxLen) {
      // Use a shorter approach: just the essential data
      const minimal = {
        people: {},
        insertionOrder: [...state.insertionOrder],
      };
      for (const id of state.insertionOrder) {
        const p = state.people[id];
        if (!p) continue;
        minimal.people[id] = {
          id: p.id,
          name: p.name,
          firstName: p.firstName,
          lastName1: p.lastName1,
          lastName2: p.lastName2,
          gender: p.gender,
          birthDate: p.birthDate,
          deceased: p.deceased,
          deathDate: p.deathDate,
          father: p.father,
          mother: p.mother,
          partners: p.partners,
        };
      }
      const minJson = JSON.stringify(minimal);
      const minUtf8 = unescape(encodeURIComponent(minJson));
      const minEncoded = btoa(minUtf8);
      shortUrl = window.location.origin + window.location.pathname + '#' + minEncoded;
    }
    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shortUrl).then(() => {
        toast('URL copiada al portapapeles');
      }).catch(() => {
        prompt('Copia esta URL:', shortUrl);
      });
    } else {
      prompt('Copia esta URL:', shortUrl);
    }
  } catch (e) {
    toast('Error al generar URL');
    console.error(e);
  }
}

function loadFromHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  try {
    const utf8 = decodeURIComponent(escape(atob(hash)));
    const data = JSON.parse(utf8);
    if (!data.people || !Object.keys(data.people).length) return false;
    const result = Tree.sanitize({ people: data.people, insertionOrder: data.insertionOrder || [] });
    applyImportedState(result.state);
    if (result.fixes?.length) {
      toast(`Se corrigieron ${result.fixes.length} inconsistencias`);
    }
    return true;
  } catch (e) {
    console.warn('Hash load failed:', e);
    return false;
  }
}

/* ===========================================================
   DARK MODE
   =========================================================== */
const DARK_MODE_KEY = 'familytree_dark_mode';

function initDarkMode() {
  const saved = localStorage.getItem(DARK_MODE_KEY);
  if (saved === 'true' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    state.darkMode = true;
    document.body.classList.add('dark-mode');
    const btn = $('darkModeBtn');
    if (btn) btn.classList.add('active');
  }
}

function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  document.body.classList.toggle('dark-mode', state.darkMode);
  const btn = $('darkModeBtn');
  if (btn) btn.classList.toggle('active', state.darkMode);
  localStorage.setItem(DARK_MODE_KEY, state.darkMode);
}


/* ===========================================================
   INIT
   =========================================================== */
function init() {
  // Dark mode
  initDarkMode();

  // Try to load from hash first (shared URL)
  if (!loadFromHash()) {
    // Try auto-save
    if (!loadAutoSave()) {
      // Center view on empty canvas
      state.view.x = wrap.clientWidth / 2;
      state.view.y = wrap.clientHeight / 2;
    }
  }
  applyTransform();
  applyLanguage(currentLang);
  syncRelationsCache();
  render();
  initDebugPanel();
  setTimeout(() => showWelcomeModal(), 120);
}

window.addEventListener('load', init);
window.addEventListener('resize', () => applyTransform());

// Keyboard: Escape closes panel/modal
document.addEventListener('keydown', e => {
  const key = String(e.key || '').toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && key === 'z') {
    e.preventDefault();
    if (undoAction()) toast('Deshacer');
    return;
  }
  if ((mod && key === 'y') || (mod && e.shiftKey && key === 'z')) {
    e.preventDefault();
    if (redoAction()) toast('Rehacer');
    return;
  }
  if (e.key === 'Escape') {
    if (modal.classList.contains('open')) closeModal();
    else if (panel.classList.contains('open')) {
      panel.classList.remove('open');
      state.selectedId = null;
      render();
    }
  }
});

// Dark mode toggle
const darkModeBtn = $('darkModeBtn');
if (darkModeBtn) {
  darkModeBtn.addEventListener('click', toggleDarkMode);
}

// Share button
const shareBtn = $('shareBtn');
if (shareBtn) {
  shareBtn.addEventListener('click', shareTreeUrl);
}

// Search keyboard navigation
const searchInput = $('searchInput');
if (searchInput) {
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const results = $('searchResults');
      if (!results || !results.classList.contains('open')) return;
      e.preventDefault();
      const items = results.querySelectorAll('.search-result');
      if (!items.length) return;
      let idx = -1;
      items.forEach((item, i) => {
        if (item.classList.contains('highlighted')) idx = i;
      });
      if (e.key === 'ArrowDown') idx = Math.min(idx + 1, items.length - 1);
      else idx = Math.max(idx - 1, 0);
      items.forEach(item => item.classList.remove('highlighted'));
      items[idx].classList.add('highlighted');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const results = $('searchResults');
      if (!results) return;
      const highlighted = results.querySelector('.search-result.highlighted');
      if (highlighted) { highlighted.click(); e.preventDefault(); }
    }
  });
}

// ===========================================================
// SERVICE WORKER REGISTRATION
// ===========================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('SW registrado:', reg.scope))
      .catch(err => console.warn('SW falló:', err));
  });
}
