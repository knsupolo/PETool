/* ==========================================================================
   수행평가 입력기 Pro (v14.1 Pro) - 핵심 통합 제어 엔진 (app.js)
   - IndexedDB 이미지 격리 스토리지 (5MB Quota 초과 원천 해결)
   - 클라우드 DB 부트스트랩 자동 로딩 & 실시간/수동 동기화
   - 0ms 반응형 측정 엔진, 1차 만점 2차 자동 패스 & 0ms 커서 이동
   - 좌측 명렬표 톤다운 차등 배지 시스템 & 1차|2차 인라인 요약 뷰
   - 가변 스플리터 리사이저 (명렬표 vs 프로필 좌우 너비 조절)
   - 학급 평균 & 1~7반 전체(학년) 통합 평균 듀얼 인포그래픽
   - 통합 명렬표 등록기 (전체 학급 일반 명단 & 사진 올인원 일괄 파서)
   - 기본 양식 엑셀 다운로드 (학급별/전체) & 수기 작성본 역업로드
   - 사진 순번 보정 도구 (Shift +1/-1 & Swap 맞교환) & 종횡비 왜곡 방지
   - 반별 점수 원클릭 초기화 (현재 종목 / 전 종목)
   - 가로형 평가 영역 탭 에디터 (순서 이동/복사 & 범위형 배점표)
   - NEIS 클립보드 원터치 복사, TTS 음성 카운트, 플로팅 스톱워치
   - 아이폰 15 프로맥스 모바일 세그먼트 전환 UX 최적화
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. 전역 상수 & 상태 관리 (State Management)
// --------------------------------------------------------------------------
const APP_VERSION = 'v14.1 Pro';
const APP_STORAGE_KEY = 'PE_EVAL_PRO_V14_1_DATA';
const SETTINGS_STORAGE_KEY = 'PE_EVAL_PRO_V14_1_SETTINGS';
const IDB_NAME = 'PE_PRO_IMAGE_DB';
const IDB_STORE = 'student_photos';

const defaultSettings = {
  gasApiUrl: 'https://script.google.com/macros/s/AKfycbyHu_eL1ih3tToXYsUlFDBZkcEepMr-mpT9-QjYlj3NQjgBrDxuUUoKXTYiNShTq-PVjw/exec',
  appTitle: '수행평가 입력기 Pro',
  theme: 'indigo',
  bg: 'slate',
  font: 'pretendard',
  classes: ['1반', '2반', '3반', '4반', '5반'],
  domains: [
    {
      id: 'domain_table_tennis',
      name: '라켓 각도 분석을 통한 탁구 포핸드 리시브 하기',
      shortName: '탁구 포핸드',
      excelHeader: '탁구포핸드',
      maxScore: 20,
      absentScore: 7,
      criteria: [
        { minCount: 8, maxCount: 10, score: 20 },
        { minCount: 7, maxCount: 7, score: 18 },
        { minCount: 6, maxCount: 6, score: 16 },
        { minCount: 5, maxCount: 5, score: 14 },
        { minCount: 4, maxCount: 4, score: 12 },
        { minCount: 2, maxCount: 3, score: 10 },
        { minCount: 0, maxCount: 1, score: 8 }
      ]
    },
    {
      id: 'domain_big_volleyball',
      name: '정확한 타구면 조절을 통한 빅발리볼 서브 하기',
      shortName: '빅발리볼 서브',
      excelHeader: '빅발리볼서브',
      maxScore: 20,
      absentScore: 7,
      criteria: [
        { minCount: 5, maxCount: 5, score: 20 },
        { minCount: 4, maxCount: 4, score: 18 },
        { minCount: 3, maxCount: 3, score: 16 },
        { minCount: 2, maxCount: 2, score: 14 },
        { minCount: 1, maxCount: 1, score: 12 },
        { minCount: 0, maxCount: 0, score: 10 }
      ]
    }
  ],
  lockedDomains: {}
};

let appState = {
  currentSemester: '2026학년도 2학기',
  semesters: ['2026학년도 1학기', '2026학년도 2학기'],
  activeClass: '1반',
  activeDomainId: 'domain_table_tennis',
  activeTrial: 1,
  selectedStudentId: null,
  activeFilter: 'all', // all, done, undone, retest, absent
  searchQuery: '',
  isDirty: false,
  isDockCollapsed: false,
  ttsEnabled: false,
  activeSettingsDomainIdx: 0,
  settings: { ...defaultSettings },
  database: {}
};

// Undo / Redo 스택
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 30;

// 웹 오디오 엔진
let audioCtx = null;

// 캔버스 사진 스튜디오 상태
let studioImage = new Image();
let studioState = {
  zoom: 100,
  scaleX: 100,
  scaleY: 100,
  rotation: 0,
  panX: 0,
  panY: 0,
  filter: 'normal',
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0
};

// 스톱워치 상태
let stopwatchInterval = null;
let stopwatchStartTime = 0;
let stopwatchElapsed = 0;
let isStopwatchRunning = false;

// --------------------------------------------------------------------------
// 2. IndexedDB 이미지 스토리지 엔진 (5MB 쿼터 초과 문제 완전 차단)
// --------------------------------------------------------------------------
function openImageDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePhotoToIDB(studentId, base64) {
  try {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ id: studentId, photo: base64, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("IndexedDB 저장 실패:", e);
    return false;
  }
}

async function getPhotoFromIDB(studentId) {
  try {
    const db = await openImageDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(studentId);
      req.onsuccess = () => resolve(req.result ? req.result.photo : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function deletePhotoFromIDB(studentId) {
  try {
    const db = await openImageDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(studentId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

// --------------------------------------------------------------------------
// 3. 로컬 스토리지 & 클라우드 DB 부트스트랩 동기화
// --------------------------------------------------------------------------
async function initLocalStorageData() {
  const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (savedSettings) {
    try {
      appState.settings = Object.assign({}, defaultSettings, JSON.parse(savedSettings));
      if (!appState.settings.gasApiUrl) appState.settings.gasApiUrl = defaultSettings.gasApiUrl;
    } catch (e) {
      appState.settings = { ...defaultSettings };
    }
  } else {
    appState.settings = { ...defaultSettings };
  }

  const savedData = localStorage.getItem(APP_STORAGE_KEY);
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData);
      appState.database = parsed.database || {};
      appState.semesters = parsed.semesters || appState.semesters;
      appState.currentSemester = parsed.currentSemester || appState.semesters[0];
    } catch (e) {
      initDummyData();
    }
  } else {
    initDummyData();
  }

  ensureSemesterData(appState.currentSemester);
  applyVisualSettings();
  updateMainTitleDisplay();

  // IndexedDB에 보관된 사진들을 메모리 상의 학생 객체에 비동기 복원
  await restoreAllPhotosFromIDB();

  // 백엔드와 연결되어 있다면 최신 데이터 패치 시도
  if (appState.settings.gasApiUrl) {
    fetchCloudDatabase(false);
  }
}

async function restoreAllPhotosFromIDB() {
  const sem = appState.currentSemester;
  const students = appState.database[sem]?.students || [];
  for (const st of students) {
    if (!st.photoUrl || st.photoUrl.startsWith('data:image/svg')) {
      const cached = await getPhotoFromIDB(st.id);
      if (cached) st.photoUrl = cached;
    }
  }
  renderStudentList();
  updateActiveStudentPanel();
}

function ensureSemesterData(semester) {
  if (!appState.database[semester]) {
    appState.database[semester] = { students: [], records: {} };
  }
  if (appState.database[semester].students.length === 0) {
    const list = [];
    appState.settings.classes.forEach(cName => {
      for (let i = 1; i <= 20; i++) {
        list.push({
          id: `${cName}-${String(i).padStart(2, '0')}`,
          classNum: cName,
          num: i,
          name: `학생${i}`,
          photoUrl: ''
        });
      }
    });
    appState.database[semester].students = list;
  }
}

function initDummyData() {
  appState.database = {};
  ensureSemesterData(appState.currentSemester);
  saveLocalState();
}

// 로컬스토리지 쿼터 초과 방지: 대용량 Base64는 제외하고 저장
function saveLocalState() {
  try {
    const lightweightDb = JSON.parse(JSON.stringify(appState.database));
    for (const sem in lightweightDb) {
      if (lightweightDb[sem]?.students) {
        lightweightDb[sem].students.forEach(st => {
          // 구글 드라이브 URL은 보존하고, 거대한 data:image Base64 문자열은 localStorage에서 제거
          if (st.photoUrl && st.photoUrl.startsWith('data:image')) {
            st.photoUrl = ''; // IDB에 영구 보존됨
          }
        });
      }
    }

    const payload = {
      currentSemester: appState.currentSemester,
      semesters: appState.semesters,
      database: lightweightDb
    };

    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appState.settings));
  } catch (err) {
    console.error("로컬 스토리지 저장 오류:", err);
  }
}

function markDirty(dirty = true) {
  appState.isDirty = dirty;
  const badge = document.getElementById('saveDirtyBadge');
  if (badge) {
    if (dirty) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
  }
}

function updateMainTitleDisplay() {
  const title = appState.settings.appTitle || '수행평가 입력기 Pro';
  const disp = document.getElementById('appMainTitleDisplay');
  const input = document.getElementById('appMainTitleInput');
  if (disp) disp.textContent = title;
  if (input) input.value = title;
}

// --------------------------------------------------------------------------
// 4. 비프음, 햅틱 & TTS 음성 카운트 엔진
// --------------------------------------------------------------------------
function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playBeep(freq = 540, duration = 0.04, type = 'sine') {
  try {
    initAudio();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.07, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

function triggerHaptic(ms = 12) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (e) {}
  }
}

function speakVoice(text) {
  if (!appState.ttsEnabled || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ko-KR';
    utter.rate = 1.15;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function feedbackAction(type = 'tap') {
  triggerHaptic(type === 'error' ? [30, 40, 30] : (type === 'success' ? [15, 20, 15] : 10));
  if (type === 'tap') playBeep(560, 0.04);
  else if (type === 'success') playBeep(760, 0.08);
  else if (type === 'pass') playBeep(430, 0.05);
  else if (type === 'clear') playBeep(310, 0.05);
  else if (type === 'error') playBeep(220, 0.12, 'sawtooth');
}

// --------------------------------------------------------------------------
// 5. Undo / Redo 스택 엔진
// --------------------------------------------------------------------------
function pushHistorySnapshot() {
  const currentSemester = appState.currentSemester;
  const recordsCopy = JSON.parse(JSON.stringify(appState.database[currentSemester].records || {}));
  undoStack.push(recordsCopy);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function applyUndo() {
  if (undoStack.length === 0) return;
  const currentSemester = appState.currentSemester;
  const currentSnap = JSON.parse(JSON.stringify(appState.database[currentSemester].records || {}));
  redoStack.push(currentSnap);

  const prevSnap = undoStack.pop();
  appState.database[currentSemester].records = prevSnap;
  markDirty(true);
  saveLocalState();
  updateUndoRedoButtons();
  renderStudentList();
  updateActiveStudentPanel();
  showToast("실행 취소(Undo) 완료");
}

function applyRedo() {
  if (redoStack.length === 0) return;
  const currentSemester = appState.currentSemester;
  const currentSnap = JSON.parse(JSON.stringify(appState.database[currentSemester].records || {}));
  undoStack.push(currentSnap);

  const nextSnap = redoStack.pop();
  appState.database[currentSemester].records = nextSnap;
  markDirty(true);
  saveLocalState();
  updateUndoRedoButtons();
  renderStudentList();
  updateActiveStudentPanel();
  showToast("다시 실행(Redo) 완료");
}

function updateUndoRedoButtons() {
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

// --------------------------------------------------------------------------
// 6. 평가 연산 및 범위형(min~max) 극간 배점표 매핑 엔진
// --------------------------------------------------------------------------
function getCurrentDomain() {
  return appState.settings.domains.find(d => d.id === appState.activeDomainId) || appState.settings.domains[0];
}

function calculateScoreFromCount(count, domain) {
  if (count === -1) return domain.absentScore !== undefined ? domain.absentScore : 0;
  if (count === null || count === undefined || count === '' || count === '-' || count === 'pass') return null;

  const numericCount = Number(count);
  if (isNaN(numericCount)) return null;

  const criteria = domain.criteria || [];
  for (const c of criteria) {
    const min = c.minCount !== undefined ? c.minCount : (c.count !== undefined ? c.count : 0);
    const max = c.maxCount !== undefined ? c.maxCount : (c.count !== undefined ? c.count : min);
    if (numericCount >= min && numericCount <= max) {
      return c.score;
    }
  }

  // 상위 범위 초과 처리
  if (criteria.length > 0) {
    const sorted = [...criteria].sort((a, b) => {
      const aMin = a.minCount !== undefined ? a.minCount : a.count;
      const bMin = b.minCount !== undefined ? b.minCount : b.count;
      return bMin - aMin;
    });
    const maxTier = sorted[0];
    const highestMax = maxTier.maxCount !== undefined ? maxTier.maxCount : maxTier.count;
    if (numericCount > highestMax) return maxTier.score;
  }

  return domain.absentScore !== undefined ? domain.absentScore : 0;
}

function getStudentRecord(studentId, domainId) {
  const currentSem = appState.currentSemester;
  const key = `${studentId}_${domainId}`;
  const rec = (appState.database[currentSem] && appState.database[currentSem].records)
    ? appState.database[currentSem].records[key]
    : null;
  return rec || { t1: null, t2: null, finalScore: null, memo: '' };
}

function updateStudentRecord(studentId, domainId, newValues) {
  pushHistorySnapshot();
  const currentSem = appState.currentSemester;
  if (!appState.database[currentSem].records) appState.database[currentSem].records = {};

  const key = `${studentId}_${domainId}`;
  const existing = appState.database[currentSem].records[key] || { t1: null, t2: null, finalScore: null, memo: '' };
  const updated = { ...existing, ...newValues };

  const domain = getCurrentDomain();
  const s1 = calculateScoreFromCount(updated.t1, domain);
  const s2 = calculateScoreFromCount(updated.t2, domain);

  if (updated.t1 === -1 && (updated.t2 === -1 || updated.t2 === null)) {
    updated.finalScore = domain.absentScore !== undefined ? domain.absentScore : 0;
  } else if (s1 !== null && s2 !== null) {
    updated.finalScore = Math.max(s1, s2);
  } else if (s1 !== null) {
    updated.finalScore = s1;
  } else if (s2 !== null) {
    updated.finalScore = s2;
  } else {
    updated.finalScore = null;
  }

  appState.database[currentSem].records[key] = updated;
  markDirty(true);
  saveLocalState();
}

function isDomainLocked(classNum, domainId) {
  const lockKey = `${appState.currentSemester}_${classNum}_${domainId}`;
  return !!appState.settings.lockedDomains[lockKey];
}

function toggleDomainLock() {
  const lockKey = `${appState.currentSemester}_${appState.activeClass}_${appState.activeDomainId}`;
  const currentStatus = !!appState.settings.lockedDomains[lockKey];
  appState.settings.lockedDomains[lockKey] = !currentStatus;
  saveLocalState();
  updateLockUI();
  feedbackAction('tap');
  showToast(appState.settings.lockedDomains[lockKey] ? "평가 입력이 마감(잠금)되었습니다." : "평가 입력이 활성화되었습니다.");
}

function updateLockUI() {
  const locked = isDomainLocked(appState.activeClass, appState.activeDomainId);
  const btn = document.getElementById('btnToggleDomainLock');
  const icon = document.getElementById('domainLockIcon');
  const text = document.getElementById('domainLockText');
  const keypad = document.getElementById('keypadEngine');

  if (btn) btn.setAttribute('data-locked', locked ? "true" : "false");
  if (text) text.textContent = locked ? "마감됨" : "입력중";
  if (icon) {
    icon.setAttribute('data-lucide', locked ? 'lock' : 'lock-open');
    if (window.lucide) lucide.createIcons();
  }
  if (keypad) {
    keypad.style.pointerEvents = locked ? 'none' : 'auto';
    keypad.style.opacity = locked ? '0.45' : '1';
  }
}

// --------------------------------------------------------------------------
// 7. 좌측 명렬표 & 서브바 렌더링 (톤다운 차등 배지 & 1차|2차 인라인 요약)
// --------------------------------------------------------------------------
function renderClassTabs() {
  const container = document.getElementById('classTabContainer');
  if (!container) return;
  container.innerHTML = '';

  appState.settings.classes.forEach(cName => {
    const btn = document.createElement('button');
    btn.className = `class-tab-btn ${cName === appState.activeClass ? 'active' : ''}`;
    btn.textContent = cName;
    btn.onclick = () => {
      appState.activeClass = cName;
      feedbackAction('tap');
      renderClassTabs();
      updateLockUI();
      selectFirstStudentInClass();
    };
    container.appendChild(btn);
  });
}

function renderDomainTabs() {
  const container = document.getElementById('domainTabContainer');
  if (!container) return;
  container.innerHTML = '';

  appState.settings.domains.forEach(d => {
    const btn = document.createElement('button');
    btn.className = `domain-tab-btn ${d.id === appState.activeDomainId ? 'active' : ''}`;
    btn.textContent = d.shortName || d.name;
    btn.onclick = () => {
      appState.activeDomainId = d.id;
      feedbackAction('tap');
      renderDomainTabs();
      updateLockUI();
      renderCriteriaChips();
      renderStudentList();
      updateActiveStudentPanel();
    };
    container.appendChild(btn);
  });
  renderCriteriaChips();
}

function renderCriteriaChips() {
  const container = document.getElementById('criteriaMiniList');
  if (!container) return;
  container.innerHTML = '';
  const domain = getCurrentDomain();
  if (!domain || !domain.criteria) return;

  domain.criteria.forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'criteria-range-chip';
    const min = c.minCount !== undefined ? c.minCount : c.count;
    const max = c.maxCount !== undefined ? c.maxCount : min;
    const rangeText = (min === max) ? `${min}회` : `${min}~${max}회`;
    chip.textContent = `${rangeText}: ${c.score}점`;
    container.appendChild(chip);
  });
}

function getFilteredStudents() {
  const sem = appState.currentSemester;
  const list = (appState.database[sem] && appState.database[sem].students) ? appState.database[sem].students : [];
  return list.filter(st => {
    if (st.classNum !== appState.activeClass) return false;
    if (appState.searchQuery) {
      const q = appState.searchQuery.toLowerCase();
      const matchName = st.name.toLowerCase().includes(q);
      const matchNum = String(st.num).includes(q);
      if (!matchName && !matchNum) return false;
    }
    const rec = getStudentRecord(st.id, appState.activeDomainId);
    const isDone = rec.finalScore !== null && rec.t1 !== -1;
    const isAbsent = rec.t1 === -1;
    const isUndone = rec.finalScore === null;
    const isRetest = !!(rec.memo && (rec.memo.includes('#재측정') || rec.memo.includes('#부상')));

    if (appState.activeFilter === 'done') return isDone;
    if (appState.activeFilter === 'absent') return isAbsent;
    if (appState.activeFilter === 'undone') return isUndone;
    if (appState.activeFilter === 'retest') return isRetest;
    return true;
  });
}

function renderStudentList() {
  const container = document.getElementById('studentListContainer');
  if (!container) return;
  container.innerHTML = '';

  const sem = appState.currentSemester;
  const allClassStudents = (appState.database[sem]?.students || []).filter(s => s.classNum === appState.activeClass);
  const filtered = getFilteredStudents();
  const domain = getCurrentDomain();

  let doneCnt = 0, absentCnt = 0, undoneCnt = 0, retestCnt = 0;
  allClassStudents.forEach(st => {
    const r = getStudentRecord(st.id, appState.activeDomainId);
    if (r.t1 === -1) absentCnt++;
    else if (r.finalScore !== null) doneCnt++;
    else undoneCnt++;

    if (r.memo && (r.memo.includes('#재측정') || r.memo.includes('#부상'))) {
      retestCnt++;
    }
  });

  const elAll = document.getElementById('cntFilterAll');
  const elDone = document.getElementById('cntFilterDone');
  const elUndone = document.getElementById('cntFilterUndone');
  const elRetest = document.getElementById('cntFilterRetest');
  const elAbsent = document.getElementById('cntFilterAbsent');
  if (elAll) elAll.textContent = allClassStudents.length;
  if (elDone) elDone.textContent = doneCnt;
  if (elUndone) elUndone.textContent = undoneCnt;
  if (elRetest) elRetest.textContent = retestCnt;
  if (elAbsent) elAbsent.textContent = absentCnt;

  filtered.forEach(student => {
    const rec = getStudentRecord(student.id, appState.activeDomainId);
    const isSelected = student.id === appState.selectedStudentId;

    const card = document.createElement('div');
    card.className = `student-card ${isSelected ? 'active-card' : ''}`;
    card.id = `studentCard_${student.id}`;

    let badgeHtml = '';
    if (rec.t1 === -1) {
      badgeHtml = `<span class="card-badge absent">미참여</span>`;
    } else if (rec.finalScore !== null) {
      const score = rec.finalScore;
      const max = domain.maxScore || 20;
      if (score >= max) {
        badgeHtml = `<span class="card-badge max">★ ${score}점</span>`;
      } else if (score >= max * 0.8) {
        badgeHtml = `<span class="card-badge high">${score}점</span>`;
      } else if (score >= max * 0.5) {
        badgeHtml = `<span class="card-badge mid">${score}점</span>`;
      } else {
        badgeHtml = `<span class="card-badge low">${score}점</span>`;
      }
    } else {
      badgeHtml = `<span class="card-badge undone">미측정</span>`;
    }

    const t1Display = rec.t1 !== null ? (rec.t1 === -1 ? '결석' : `${rec.t1}회`) : '-';
    const t2Display = rec.t2 !== null ? (rec.t2 === -1 ? '결석' : (rec.t2 === 'pass' ? '패스(-)' : `${rec.t2}회`)) : '-';

    const avatarUrl = student.photoUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'%3E%3C/path%3E%3Ccircle cx='12' cy='7' r='4'%3E%3C/circle%3E%3C/svg%3E";
    const hasMemo = !!rec.memo;

    card.innerHTML = `
      <span class="card-num">${student.num}</span>
      <img src="${avatarUrl}" class="card-avatar" alt="사진">
      <div class="card-info">
        <div class="card-name-row">
          <span class="card-name">${student.name}</span>
          ${hasMemo ? `<span class="memo-dot" style="position:static;display:inline-block;" title="${rec.memo}"></span>` : ''}
        </div>
        <div class="card-scores-row">
          <span class="trial-split-box">1차: <b class="trial-val">${t1Display}</b></span>
          <span>|</span>
          <span class="trial-split-box">2차: <b class="trial-val">${t2Display}</b></span>
        </div>
      </div>
      ${badgeHtml}
    `;

    card.onclick = () => {
      appState.selectedStudentId = student.id;
      feedbackAction('tap');
      renderStudentList();
      updateActiveStudentPanel();

      // 모바일(아이폰 등) 화면일 때 카드 터치 시 즉시 측정 패널 뷰로 전환
      if (window.innerWidth <= 900) {
        setMobileView('measure');
      }
    };

    container.appendChild(card);
  });

  updateRosterPositionText();
}

function selectFirstStudentInClass() {
  const students = getFilteredStudents();
  if (students.length > 0) {
    appState.selectedStudentId = students[0].id;
  } else {
    appState.selectedStudentId = null;
  }
  renderStudentList();
  updateActiveStudentPanel();
}

function updateRosterPositionText() {
  const sem = appState.currentSemester;
  const list = (appState.database[sem]?.students || []).filter(s => s.classNum === appState.activeClass);
  const curIdx = list.findIndex(s => s.id === appState.selectedStudentId);

  const idxEl = document.getElementById('currentStudentIndex');
  const totalEl = document.getElementById('totalStudentsInClass');
  if (idxEl) idxEl.textContent = curIdx >= 0 ? curIdx + 1 : 0;
  if (totalEl) totalEl.textContent = list.length;
}

// --------------------------------------------------------------------------
// 8. 활성 학생 측정 패널 & 학급/학년 전체 인포그래픽 업데이트
// --------------------------------------------------------------------------
function getSelectedStudent() {
  const sem = appState.currentSemester;
  const list = appState.database[sem]?.students || [];
  return list.find(s => s.id === appState.selectedStudentId) || null;
}

function updateActiveStudentPanel() {
  const student = getSelectedStudent();
  const domain = getCurrentDomain();

  const nameEl = document.getElementById('activeStudentName');
  const classEl = document.getElementById('activeStudentClass');
  const numEl = document.getElementById('activeStudentNumber');
  const avatarEl = document.getElementById('activeStudentAvatar');
  const statusBadge = document.getElementById('activeStudentStatusBadge');
  const dispT1 = document.getElementById('dispT1Count');
  const dispT2 = document.getElementById('dispT2Count');
  const dispFinal = document.getElementById('dispFinalScore');
  const activeCountEl = document.getElementById('activeTrialCount');
  const activeScoreEl = document.getElementById('activeCalculatedScore');
  const activeMetricTitle = document.getElementById('activeMetricTitle');
  const memoDot = document.getElementById('activeMemoIndicator');

  if (!student) {
    if (nameEl) nameEl.textContent = "학생을 선택하세요";
    if (classEl) classEl.textContent = "-반";
    if (numEl) numEl.textContent = "-번";
    if (dispT1) dispT1.textContent = "-";
    if (dispT2) dispT2.textContent = "-";
    if (dispFinal) dispFinal.textContent = "-";
    if (activeCountEl) activeCountEl.textContent = "-";
    if (activeScoreEl) activeScoreEl.textContent = "환산 점수: - 점";
    updateDualInfographic(null, domain);
    return;
  }

  const rec = getStudentRecord(student.id, appState.activeDomainId);

  if (nameEl) nameEl.textContent = student.name;
  if (classEl) classEl.textContent = student.classNum;
  if (numEl) numEl.textContent = `${student.num}번`;
  if (avatarEl) {
    avatarEl.src = student.photoUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'%3E%3C/path%3E%3Ccircle cx='12' cy='7' r='4'%3E%3C/circle%3E%3C/svg%3E";
  }

  if (statusBadge) {
    if (rec.t1 === -1) {
      statusBadge.className = 'status-badge card-badge absent';
      statusBadge.textContent = '미참여(결석)';
    } else if (rec.finalScore !== null) {
      statusBadge.className = 'status-badge card-badge done';
      statusBadge.textContent = `${rec.finalScore}점 완료`;
    } else {
      statusBadge.className = 'status-badge card-badge undone';
      statusBadge.textContent = '대기';
    }
  }

  if (dispT1) dispT1.textContent = rec.t1 !== null ? (rec.t1 === -1 ? '결석' : `${rec.t1}회`) : '-';
  if (dispT2) dispT2.textContent = rec.t2 !== null ? (rec.t2 === -1 ? '결석' : (rec.t2 === 'pass' ? '패스(-)' : `${rec.t2}회`)) : '-';
  if (dispFinal) dispFinal.textContent = rec.finalScore !== null ? `${rec.finalScore} 점` : '-';

  const curVal = appState.activeTrial === 1 ? rec.t1 : rec.t2;
  if (activeMetricTitle) activeMetricTitle.textContent = `${appState.activeTrial}차 시기 입력 성공 횟수`;

  if (activeCountEl) {
    if (curVal === -1) activeCountEl.textContent = '결석';
    else if (curVal === 'pass') activeCountEl.textContent = '패스';
    else if (curVal !== null && curVal !== undefined) activeCountEl.textContent = `${curVal} 회`;
    else activeCountEl.textContent = '-';
  }

  if (activeScoreEl) {
    const sc = calculateScoreFromCount(curVal, domain);
    activeScoreEl.textContent = sc !== null ? `환산 점수: ${sc} 점` : '환산 점수: - 점';
  }

  if (memoDot) {
    if (rec.memo) memoDot.classList.remove('hidden');
    else memoDot.classList.add('hidden');
  }

  updateTrialSegmentUI();
  updateDualInfographic(student, domain);
}

// 8. 듀얼 인포그래픽 (학급 평균 vs 1~7반 전체 평균 지표)
function updateDualInfographic(student, domain) {
  const targetLabel = document.getElementById('analyticsStudentTargetLabel');
  const diffBadge = document.getElementById('dispClassAvgDiff');
  const myScoreEl = document.getElementById('dispCurrentStudentScore');
  const classAvgEl = document.getElementById('dispClassAvgScore');
  const schoolAvgEl = document.getElementById('dispSchoolAvgScore');
  const avgGauge = document.getElementById('dispClassAvgGauge');
  const markerClass = document.getElementById('markerClassAvg');
  const markerSchool = document.getElementById('markerSchoolAvg');
  const improveBadge = document.getElementById('dispTrialImprovement');
  const improveGauge = document.getElementById('dispTrialImproveGauge');
  const improveText = document.getElementById('dispTrialImproveText');
  const compCountText = document.getElementById('dispDomainCompletedCount');
  const badgesContainer = document.getElementById('dispDomainProgressBadges');

  if (!student) {
    if (targetLabel) targetLabel.textContent = "-";
    if (diffBadge) diffBadge.textContent = "-";
    if (myScoreEl) myScoreEl.textContent = "0점";
    if (classAvgEl) classAvgEl.textContent = "0점";
    if (schoolAvgEl) schoolAvgEl.textContent = "0점";
    if (avgGauge) avgGauge.style.width = "50%";
    return;
  }

  if (targetLabel) targetLabel.textContent = `${student.name} (${student.classNum})`;

  const sem = appState.currentSemester;
  const allStudents = appState.database[sem]?.students || [];
  const classStudents = allStudents.filter(s => s.classNum === student.classNum);

  // 1) 학급 평균
  let classSum = 0, classDone = 0;
  classStudents.forEach(st => {
    const r = getStudentRecord(st.id, domain.id);
    if (r.finalScore !== null && r.t1 !== -1) {
      classSum += r.finalScore;
      classDone++;
    }
  });
  const classAvg = classDone > 0 ? (classSum / classDone) : 0;

  // 2) 1~7반 전체(학년) 통합 평균
  let schoolSum = 0, schoolDone = 0;
  allStudents.forEach(st => {
    const r = getStudentRecord(st.id, domain.id);
    if (r.finalScore !== null && r.t1 !== -1) {
      schoolSum += r.finalScore;
      schoolDone++;
    }
  });
  const schoolAvg = schoolDone > 0 ? (schoolSum / schoolDone) : 0;

  const curRec = getStudentRecord(student.id, domain.id);
  const myScore = curRec.finalScore !== null ? curRec.finalScore : 0;
  const max = domain.maxScore || 20;

  if (myScoreEl) myScoreEl.textContent = curRec.finalScore !== null ? `${myScore}점` : '미측정';
  if (classAvgEl) classAvgEl.textContent = `${classAvg.toFixed(1)}점`;
  if (schoolAvgEl) schoolAvgEl.textContent = `${schoolAvg.toFixed(1)}점`;

  // 듀얼 게이지 마커 위치 산출 (0~100%)
  if (markerClass) markerClass.style.left = `${Math.min(100, Math.max(0, (classAvg / max) * 100))}%`;
  if (markerSchool) markerSchool.style.left = `${Math.min(100, Math.max(0, (schoolAvg / max) * 100))}%`;

  if (curRec.finalScore !== null) {
    const diff = myScore - classAvg;
    const sign = diff > 0 ? '+' : '';
    if (diffBadge) {
      diffBadge.textContent = `학급평균 대비 ${sign}${diff.toFixed(1)}점`;
      diffBadge.className = `metric-badge ${diff >= 0 ? 'highlight' : ''}`;
    }
    const myRatio = Math.min(100, Math.max(0, (myScore / max) * 100));
    if (avgGauge) avgGauge.style.width = `${myRatio}%`;
  } else {
    if (diffBadge) diffBadge.textContent = "측정 대기";
    if (avgGauge) avgGauge.style.width = "0%";
  }

  // 3) 1차 대비 2차 향상도
  const s1 = calculateScoreFromCount(curRec.t1, domain);
  const s2 = calculateScoreFromCount(curRec.t2, domain);

  if (s1 !== null && s2 !== null) {
    const impDiff = s2 - s1;
    if (impDiff > 0) {
      if (improveBadge) improveBadge.textContent = `▲ +${impDiff}점 향상`;
      if (improveText) improveText.textContent = `1차(${s1}점) → 2차(${s2}점) 성공적 향상`;
      if (improveGauge) improveGauge.style.width = "100%";
    } else if (impDiff === 0) {
      if (improveBadge) improveBadge.textContent = `유지 (0점)`;
      if (improveText) improveText.textContent = `1차·2차 동일 점수 취득`;
      if (improveGauge) improveGauge.style.width = "50%";
    } else {
      if (improveBadge) improveBadge.textContent = `▼ ${impDiff}점`;
      if (improveText) improveText.textContent = `1차 성적이 더 우수함`;
      if (improveGauge) improveGauge.style.width = "30%";
    }
  } else if (curRec.t2 === 'pass') {
    if (improveBadge) improveBadge.textContent = `1차 만점 패스`;
    if (improveText) improveText.textContent = `1차 만점 달성으로 2차 패스`;
    if (improveGauge) improveGauge.style.width = "100%";
  } else {
    if (improveBadge) improveBadge.textContent = `-`;
    if (improveText) improveText.textContent = `2차 시기 측정 전`;
    if (improveGauge) improveGauge.style.width = "0%";
  }

  // 4) 전 영역 이수 배지
  const domains = appState.settings.domains;
  let completedDomainCount = 0;
  if (badgesContainer) {
    badgesContainer.innerHTML = '';
    domains.forEach(d => {
      const dRec = getStudentRecord(student.id, d.id);
      const isDone = dRec.finalScore !== null;
      if (isDone) completedDomainCount++;

      const pill = document.createElement('span');
      pill.className = `domain-mini-pill ${isDone ? 'done' : ''}`;
      const scoreStr = isDone ? `${dRec.finalScore}점` : '미완료';
      pill.textContent = `${d.shortName || d.name}: ${scoreStr}`;
      badgesContainer.appendChild(pill);
    });
  }
  if (compCountText) compCountText.textContent = `${completedDomainCount} / ${domains.length} 영역 완료`;
}

function updateTrialSegmentUI() {
  document.querySelectorAll('#trialSegment .segment-btn').forEach(btn => {
    const t = Number(btn.getAttribute('data-trial'));
    if (t === appState.activeTrial) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function handleKeypadInput(value) {
  const student = getSelectedStudent();
  if (!student) return;
  if (isDomainLocked(appState.activeClass, appState.activeDomainId)) {
    feedbackAction('error');
    showToast("입력이 마감되어 기록을 변경할 수 없습니다.");
    return;
  }

  const domain = getCurrentDomain();
  const autoPass = document.getElementById('chkAutoPass')?.checked ?? true;
  const trial = appState.activeTrial;

  if (value === 'pass') {
    if (trial === 1) {
      showToast("패스는 2차 시기에 적용됩니다.");
      appState.activeTrial = 2;
    }
    updateStudentRecord(student.id, appState.activeDomainId, { t2: 'pass' });
    speakVoice("패스");
    feedbackAction('pass');
    moveToNextStudent(1);
    return;
  }

  if (value === 'absent') {
    updateStudentRecord(student.id, appState.activeDomainId, { t1: -1, t2: -1 });
    speakVoice("결석");
    feedbackAction('clear');
    moveToNextStudent(1);
    return;
  }

  if (value === 'clear') {
    if (trial === 1) {
      updateStudentRecord(student.id, appState.activeDomainId, { t1: null, t2: null });
    } else {
      updateStudentRecord(student.id, appState.activeDomainId, { t2: null });
    }
    speakVoice("초기화");
    feedbackAction('clear');
    renderStudentList();
    updateActiveStudentPanel();
    return;
  }

  const count = Number(value);
  const score = calculateScoreFromCount(count, domain);

  if (trial === 1) {
    if (autoPass && score >= domain.maxScore) {
      updateStudentRecord(student.id, appState.activeDomainId, { t1: count, t2: 'pass' });
      speakVoice(`${count}회, 만점`);
      feedbackAction('success');
      showToast(`${student.name} 1차 만점! 2차 자동 패스`);
      moveToNextStudent(1);
      return;
    } else {
      updateStudentRecord(student.id, appState.activeDomainId, { t1: count });
      speakVoice(`${count}회`);
      feedbackAction('tap');
      appState.activeTrial = 2;
      renderStudentList();
      updateActiveStudentPanel();
      return;
    }
  } else {
    updateStudentRecord(student.id, appState.activeDomainId, { t2: count });
    speakVoice(`${count}회`);
    feedbackAction('tap');
    moveToNextStudent(1);
  }
}

function moveToNextStudent(step = 1) {
  const sem = appState.currentSemester;
  const list = (appState.database[sem]?.students || []).filter(s => s.classNum === appState.activeClass);
  if (list.length === 0) return;

  let curIdx = list.findIndex(s => s.id === appState.selectedStudentId);
  let nextIdx = curIdx + step;

  if (nextIdx >= list.length) {
    showToast("학급의 마지막 학생입니다.");
    nextIdx = list.length - 1;
  } else if (nextIdx < 0) {
    nextIdx = 0;
  }

  appState.selectedStudentId = list[nextIdx].id;
  appState.activeTrial = 1;
  renderStudentList();
  updateActiveStudentPanel();

  const card = document.getElementById(`studentCard_${appState.selectedStudentId}`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --------------------------------------------------------------------------
// 9. 캔버스 사진 스튜디오 (종횡비 왜곡 방지 Center-Crop & 8종 필터)
// --------------------------------------------------------------------------
function openPhotoStudio() {
  const student = getSelectedStudent();
  if (!student) {
    showToast("사진을 등록할 학생을 먼저 선택하세요.");
    return;
  }

  const modal = document.getElementById('photoStudioModal');
  if (modal) modal.classList.remove('hidden');

  studioState = {
    zoom: 100,
    scaleX: 100,
    scaleY: 100,
    rotation: 0,
    panX: 0,
    panY: 0,
    filter: 'normal',
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0
  };

  syncStudioSliders();

  studioImage = new Image();
  studioImage.crossOrigin = "anonymous";
  studioImage.onload = () => renderStudioCanvas();
  studioImage.src = student.photoUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'%3E%3C/path%3E%3Ccircle cx='12' cy='7' r='4'%3E%3C/circle%3E%3C/svg%3E";
}

function syncStudioSliders() {
  const zSlider = document.getElementById('zoomSlider');
  const zVal = document.getElementById('zoomVal');
  const sxSlider = document.getElementById('scaleXSlider');
  const sxVal = document.getElementById('scaleXVal');
  const sySlider = document.getElementById('scaleYSlider');
  const syVal = document.getElementById('scaleYVal');

  if (zSlider) zSlider.value = studioState.zoom;
  if (zVal) zVal.textContent = `${studioState.zoom}%`;
  if (sxSlider) sxSlider.value = studioState.scaleX;
  if (sxVal) sxVal.textContent = `${studioState.scaleX}%`;
  if (sySlider) sySlider.value = studioState.scaleY;
  if (syVal) syVal.textContent = `${studioState.scaleY}%`;
}

function renderStudioCanvas() {
  const canvas = document.getElementById('photoEditorCanvas');
  if (!canvas || !studioImage.complete) return;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();

  ctx.translate(canvas.width / 2 + studioState.panX, canvas.height / 2 + studioState.panY);
  ctx.rotate((studioState.rotation * Math.PI) / 180);
  ctx.scale((studioState.zoom / 100) * (studioState.scaleX / 100), (studioState.zoom / 100) * (studioState.scaleY / 100));

  // 정비율 센터 크롭 알고리즘 (사진 가로 납작해짐 방지)
  const imgW = studioImage.width || 400;
  const imgH = studioImage.height || 400;
  const aspect = imgW / imgH;
  let drawW = 300;
  let drawH = 300 / aspect;
  if (drawH < 300) {
    drawH = 300;
    drawW = 300 * aspect;
  }

  ctx.drawImage(studioImage, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  if (studioState.filter !== 'normal') {
    applyCanvasFilterMath(ctx, canvas.width, canvas.height, studioState.filter);
  }
}

function applyCanvasFilterMath(ctx, width, height, filterName) {
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i+1], b = d[i+2];

      if (filterName === 'bright') {
        r = r * 1.15 + 12; g = g * 1.12 + 10; b = b * 1.08 + 8;
      } else if (filterName === 'warm') {
        r = r * 1.14 + 14; g = g * 1.05 + 6; b = b * 0.90;
      } else if (filterName === 'vivid') {
        r = (r - 128) * 1.25 + 128; g = (g - 128) * 1.25 + 128; b = (b - 128) * 1.25 + 128;
      } else if (filterName === 'bw') {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = gray;
      } else if (filterName === 'glitch') {
        r = r * 1.2; b = b * 1.3;
      } else if (filterName === 'vintage') {
        r = r * 1.1 + 10; g = g * 0.95; b = b * 0.8 + 15;
      } else if (filterName === 'cool') {
        r = r * 0.9; g = g * 1.05 + 4; b = b * 1.2 + 14;
      }

      d[i] = Math.min(255, Math.max(0, r));
      d[i+1] = Math.min(255, Math.max(0, g));
      d[i+2] = Math.min(255, Math.max(0, b));
    }
    ctx.putImageData(imgData, 0, 0);
  } catch (e) {}
}

function initCanvasStudioEvents() {
  const viewport = document.getElementById('canvasViewport');
  if (!viewport) return;

  function onStart(e) {
    studioState.isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    studioState.dragStartX = clientX - studioState.panX;
    studioState.dragStartY = clientY - studioState.panY;
  }

  function onMove(e) {
    if (!studioState.isDragging) return;
    if (e.cancelable) e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    studioState.panX = clientX - studioState.dragStartX;
    studioState.panY = clientY - studioState.dragStartY;
    renderStudioCanvas();
  }

  function onEnd() {
    studioState.isDragging = false;
  }

  viewport.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  viewport.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd);

  document.getElementById('zoomSlider')?.addEventListener('input', (e) => {
    studioState.zoom = Number(e.target.value);
    document.getElementById('zoomVal').textContent = `${studioState.zoom}%`;
    renderStudioCanvas();
  });
  document.getElementById('scaleXSlider')?.addEventListener('input', (e) => {
    studioState.scaleX = Number(e.target.value);
    document.getElementById('scaleXVal').textContent = `${studioState.scaleX}%`;
    renderStudioCanvas();
  });
  document.getElementById('scaleYSlider')?.addEventListener('input', (e) => {
    studioState.scaleY = Number(e.target.value);
    document.getElementById('scaleYVal').textContent = `${studioState.scaleY}%`;
    renderStudioCanvas();
  });

  document.getElementById('btnRotate90')?.addEventListener('click', () => {
    studioState.rotation = (studioState.rotation + 90) % 360;
    renderStudioCanvas();
  });
  document.getElementById('btnResetTransform')?.addEventListener('click', () => {
    studioState.zoom = 100;
    studioState.scaleX = 100;
    studioState.scaleY = 100;
    studioState.rotation = 0;
    studioState.panX = 0;
    studioState.panY = 0;
    syncStudioSliders();
    renderStudioCanvas();
  });

  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      studioState.filter = btn.getAttribute('data-filter');
      renderStudioCanvas();
    });
  });

  const handleImageFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      studioImage = new Image();
      studioImage.onload = () => {
        studioState.panX = 0;
        studioState.panY = 0;
        renderStudioCanvas();
      };
      studioImage.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  document.getElementById('cameraFileInput')?.addEventListener('change', (e) => handleImageFile(e.target.files[0]));
  document.getElementById('albumFileInput')?.addEventListener('change', (e) => handleImageFile(e.target.files[0]));

  document.getElementById('btnSaveStudioAvatar')?.addEventListener('click', async () => {
    const student = getSelectedStudent();
    if (!student) return;
    const canvas = document.getElementById('photoEditorCanvas');
    const base64 = canvas.toDataURL('image/jpeg', 0.88);

    student.photoUrl = base64;
    await savePhotoToIDB(student.id, base64);

    markDirty(true);
    saveLocalState();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast(`${student.name} 프로필 사진이 저장되었습니다.`);

    if (appState.settings.gasApiUrl) {
      callGasApi('SAVE_STUDENT_AVATAR', {
        semester: appState.currentSemester,
        gradeClass: student.classNum.replace(/[^0-9]/g, ''),
        number: student.num,
        name: student.name,
        base64Data: base64
      }).then(res => {
        if (res && res.avatarUrl) {
          student.photoUrl = res.avatarUrl;
          saveLocalState();
        }
      }).catch(() => {});
    }
  });

  document.getElementById('btnDeleteCurrentAvatar')?.addEventListener('click', async () => {
    const student = getSelectedStudent();
    if (!student) return;
    if (confirm("이 학생의 사진을 완전히 삭제하시겠습니까?")) {
      student.photoUrl = '';
      await deletePhotoFromIDB(student.id);

      markDirty(true);
      saveLocalState();
      renderStudentList();
      updateActiveStudentPanel();
      closeAllModals();
      showToast("프로필 사진이 삭제되었습니다.");

      if (appState.settings.gasApiUrl) {
        callGasApi('DELETE_STUDENT_AVATAR', {
          semester: appState.currentSemester,
          gradeClass: student.classNum.replace(/[^0-9]/g, ''),
          number: student.num
        }).catch(() => {});
      }
    }
  });
}

// --------------------------------------------------------------------------
// 10. 통합 명렬표 등록 모달 (전체 학급 일괄 지원 & 사진 자동 매칭)
// --------------------------------------------------------------------------
function initIntegratedRosterUploader() {
  const dropZone = document.getElementById('integratedRosterDropZone');
  const fileInput = document.getElementById('integratedExcelFileInput');

  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
  dropZone?.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--primary-border)'; });
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--primary-border)';
    if (e.dataTransfer.files.length > 0) processIntegratedExcelFile(e.dataTransfer.files[0]);
  });
  fileInput?.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processIntegratedExcelFile(e.target.files[0]);
  });
}

async function processIntegratedExcelFile(file) {
  if (!file) return;
  const pWrap = document.getElementById('integratedProgressWrap');
  const pBar = document.getElementById('integratedProgressBar');
  const pText = document.getElementById('integratedProgressText');
  if (pWrap) pWrap.classList.remove('hidden');

  try {
    pText.textContent = "전체 학급 명렬표 파싱 중...";
    pBar.style.width = "20%";

    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

    let colClass = -1, colNum = -1, colName = -1;
    let headerRowIdx = 0;

    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim();
        if (val.includes('학급') || val.includes('반')) colClass = c;
        if (val.includes('번호')) colNum = c;
        if (val.includes('성명') || val.includes('이름')) colName = c;
      }
      if (colNum !== -1 && colName !== -1) {
        headerRowIdx = i;
        break;
      }
    }
    if (colNum === -1 || colName === -1) {
      colClass = 1; colNum = 2; colName = 3;
    }

    const sem = appState.currentSemester;
    const existingStudents = appState.database[sem]?.students || [];
    let studentMergedCount = 0;
    const detectedClasses = new Set(appState.settings.classes);

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[colName]) continue;

      let cVal = colClass !== -1 && row[colClass] ? String(row[colClass]).trim() : appState.activeClass;
      if (!cVal.includes('반')) cVal = `${cVal}반`;
      const numVal = parseInt(row[colNum]) || (r - headerRowIdx);
      const nameVal = String(row[colName]).trim();

      detectedClasses.add(cVal);

      const found = existingStudents.find(s => s.classNum === cVal && s.num === numVal);
      if (found) {
        found.name = nameVal;
      } else {
        existingStudents.push({
          id: `${cVal}-${String(numVal).padStart(2, '0')}`,
          classNum: cVal,
          num: numVal,
          name: nameVal,
          photoUrl: ''
        });
        studentMergedCount++;
      }
    }

    // 초기 학급 자동 생성 및 정렬 반영
    appState.settings.classes = Array.from(detectedClasses).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
    existingStudents.sort((a, b) => (parseInt(a.classNum) || 0) - (parseInt(b.classNum) || 0) || a.num - b.num);

    pBar.style.width = "50%";
    pText.textContent = "압축 사진 데이터 스캔 중...";

    let photoMatchedCount = 0;
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const mediaFiles = Object.keys(zip.files).filter(f => f.startsWith('xl/media/'));

      if (mediaFiles.length > 0) {
        pText.textContent = `사진 ${mediaFiles.length}장 추출 및 자동 매칭 중...`;
        mediaFiles.sort((a, b) => {
          const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
          const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
          return numA - numB;
        });

        const activeClassStudents = existingStudents
          .filter(s => s.classNum === appState.activeClass)
          .sort((a, b) => a.num - b.num);

        const avatarBatch = [];
        for (let i = 0; i < Math.min(mediaFiles.length, activeClassStudents.length); i++) {
          const fName = mediaFiles[i];
          const imgBlob = await zip.files[fName].async('blob');
          const base64Data = await new Promise(res => {
            const rd = new FileReader();
            rd.onloadend = () => res(rd.result);
            rd.readAsDataURL(imgBlob);
          });

          activeClassStudents[i].photoUrl = base64Data;
          await savePhotoToIDB(activeClassStudents[i].id, base64Data);

          avatarBatch.push({
            number: activeClassStudents[i].num,
            name: activeClassStudents[i].name,
            base64Data: base64Data
          });
          photoMatchedCount++;
          pBar.style.width = `${50 + Math.round((i / activeClassStudents.length) * 45)}%`;
        }

        // 백엔드 클라우드 일괄 저장
        if (appState.settings.gasApiUrl && avatarBatch.length > 0) {
          callGasApi('SAVE_BATCH_AVATARS', {
            semester: appState.currentSemester,
            gradeClass: appState.activeClass.replace(/[^0-9]/g, ''),
            avatarBatch: avatarBatch
          }).then(res => {
            if (res && res.savedResults) {
              activeClassStudents.forEach(st => {
                if (res.savedResults[st.num]) st.photoUrl = res.savedResults[st.num];
              });
              saveLocalState();
              renderStudentList();
            }
          }).catch(() => {});
        }
      }
    } catch (zipErr) {}

    markDirty(true);
    saveLocalState();
    renderClassTabs();
    renderStudentList();
    updateActiveStudentPanel();

    pBar.style.width = "100%";
    pText.textContent = "통합 등록 완료!";

    setTimeout(() => {
      closeAllModals();
      if (pWrap) pWrap.classList.add('hidden');
      showToast(`전체 학급(${detectedClasses.size}개 반) 명렬표 등록 완료! (학생 ${studentMergedCount}명 / 사진 ${photoMatchedCount}장) 📑`);
    }, 600);

  } catch (err) {
    alert("명렬표 등록 실패: " + err.message);
    if (pWrap) pWrap.classList.add('hidden');
  }
}

// --------------------------------------------------------------------------
// 11. 수기 입력용 기본 양식 다운로드 & 역업로드 (학급별 / 전체 학급)
// --------------------------------------------------------------------------
function initTemplateModal() {
  document.getElementById('btnOpenTemplateModal')?.addEventListener('click', () => {
    const lbl = document.getElementById('btnDownloadClassTemplateLabel');
    if (lbl) lbl.textContent = `현재 반(${appState.activeClass}) 수기 양식 엑셀 다운로드`;
    openModal('templateModal');
  });

  // 학급별 수기 양식
  document.getElementById('btnDownloadClassTemplate')?.addEventListener('click', () => {
    exportManualEntryTemplate(false);
  });

  // 전체 학급 통합 수기 양식
  document.getElementById('btnDownloadAllTemplate')?.addEventListener('click', () => {
    exportManualEntryTemplate(true);
  });

  // 수기 작성본 역업로드
  document.getElementById('templateUploadFileInput')?.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleReverseExcelUpload(e.target.files[0]);
  });
}

function exportManualEntryTemplate(isAllClasses = false) {
  const sem = appState.currentSemester;
  const allStudents = appState.database[sem]?.students || [];
  const targetStudents = isAllClasses 
    ? allStudents 
    : allStudents.filter(s => s.classNum === appState.activeClass);

  if (targetStudents.length === 0) {
    alert("명렬표가 비어 있습니다. 먼저 학생 명단을 등록하세요.");
    return;
  }

  const curDomain = getCurrentDomain();
  const rows = [
    ['학기', '학급', '번호', '성명', '평가영역', '1차시기(성공횟수)', '2차시기(성공횟수)', '비고(관찰메모)']
  ];

  targetStudents.forEach(st => {
    const rec = getStudentRecord(st.id, curDomain.id);
    rows.push([
      sem,
      st.classNum,
      st.num,
      st.name,
      curDomain.name,
      rec.t1 !== null ? (rec.t1 === -1 ? '결석' : rec.t1) : '',
      rec.t2 !== null ? (rec.t2 === -1 ? '결석' : (rec.t2 === 'pass' ? '패스' : rec.t2)) : '',
      rec.memo || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "수기입력양식");

  const tag = isAllClasses ? "전체학급" : appState.activeClass;
  XLSX.writeFile(wb, `[수행평가양식]_${tag}_${curDomain.shortName || curDomain.name}.xlsx`);
  showToast(`${tag} 기본 양식 엑셀이 다운로드되었습니다. 📑`);
}

// --------------------------------------------------------------------------
// 12. 사진 순번 보정 도구 (Shift +1/-1 & Swap 맞교환)
// --------------------------------------------------------------------------
function initPhotoCorrectionModal() {
  document.getElementById('btnOpenPhotoCorrection')?.addEventListener('click', () => {
    openModal('photoCorrectionModal');
  });

  // +1칸 뒤로 밀기
  document.getElementById('btnShiftPhotoBack')?.addEventListener('click', async () => {
    const startNum = parseInt(document.getElementById('shiftStartNumber')?.value);
    if (!startNum) return alert("시작 번호를 입력하세요.");
    await shiftClassPhotos(startNum, 1);
  });

  // -1칸 앞으로 당기기
  document.getElementById('btnShiftPhotoForward')?.addEventListener('click', async () => {
    const startNum = parseInt(document.getElementById('shiftStartNumber')?.value);
    if (!startNum) return alert("시작 번호를 입력하세요.");
    await shiftClassPhotos(startNum, -1);
  });

  // 두 학생 사진 맞교환 (Swap)
  document.getElementById('btnConfirmSwapPhotos')?.addEventListener('click', async () => {
    const n1 = parseInt(document.getElementById('swapNum1')?.value);
    const n2 = parseInt(document.getElementById('swapNum2')?.value);
    if (!n1 || !n2 || n1 === n2) return alert("서로 다른 두 학생 번호를 입력하세요.");

    const sem = appState.currentSemester;
    const classStudents = (appState.database[sem]?.students || []).filter(s => s.classNum === appState.activeClass);
    const st1 = classStudents.find(s => s.num === n1);
    const st2 = classStudents.find(s => s.num === n2);

    if (!st1 || !st2) return alert("해당 학생을 찾을 수 없습니다.");

    const temp = st1.photoUrl;
    st1.photoUrl = st2.photoUrl;
    st2.photoUrl = temp;

    await savePhotoToIDB(st1.id, st1.photoUrl);
    await savePhotoToIDB(st2.id, st2.photoUrl);

    markDirty(true);
    saveLocalState();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast(`${n1}번과 ${n2}번 학생의 사진이 성공적으로 맞교환되었습니다! 🔄`);
  });
}

async function shiftClassPhotos(startNum, direction) {
  const sem = appState.currentSemester;
  const classStudents = (appState.database[sem]?.students || [])
    .filter(s => s.classNum === appState.activeClass)
    .sort((a, b) => a.num - b.num);

  if (direction > 0) {
    for (let i = classStudents.length - 1; i >= 0; i--) {
      if (classStudents[i].num >= startNum) {
        const prevStudent = classStudents[i - 1];
        classStudents[i].photoUrl = (prevStudent && prevStudent.num >= startNum) ? prevStudent.photoUrl : '';
        await savePhotoToIDB(classStudents[i].id, classStudents[i].photoUrl);
      }
    }
  } else {
    for (let i = 0; i < classStudents.length; i++) {
      if (classStudents[i].num >= startNum) {
        const nextStudent = classStudents[i + 1];
        classStudents[i].photoUrl = nextStudent ? nextStudent.photoUrl : '';
        await savePhotoToIDB(classStudents[i].id, classStudents[i].photoUrl);
      }
    }
  }

  markDirty(true);
  saveLocalState();
  renderStudentList();
  updateActiveStudentPanel();
  closeAllModals();
  showToast(`${startNum}번부터 사진 순번이 ${direction > 0 ? '+1칸 뒤로' : '-1칸 앞으로'} 정정되었습니다! 🎯`);
}

// --------------------------------------------------------------------------
// 13. 반별 점수 원클릭 초기화 (현재 종목 / 전 종목)
// --------------------------------------------------------------------------
function initClassResetModal() {
  document.getElementById('btnOpenClassReset')?.addEventListener('click', () => {
    const curDomain = getCurrentDomain();
    const lbl = document.getElementById('resetTargetClassLabel');
    const domTxt = document.getElementById('resetCurrentDomainNameText');
    if (lbl) lbl.textContent = appState.activeClass;
    if (domTxt) domTxt.textContent = `[${curDomain.shortName || curDomain.name}] 기록만 깨끗이 비웁니다.`;
    openModal('classResetModal');
  });

  document.getElementById('btnConfirmResetCurrentDomain')?.addEventListener('click', () => {
    const curDomain = getCurrentDomain();
    if (!confirm(`[${appState.activeClass}]의 [${curDomain.shortName || curDomain.name}] 기록을 초기화하시겠습니까?`)) return;
    pushHistorySnapshot();

    const sem = appState.currentSemester;
    const students = appState.database[sem]?.students || [];
    students.filter(s => s.classNum === appState.activeClass).forEach(st => {
      const key = `${st.id}_${curDomain.id}`;
      if (appState.database[sem].records[key]) {
        delete appState.database[sem].records[key];
      }
    });

    markDirty(true);
    saveLocalState();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast(`${appState.activeClass} [${curDomain.shortName || curDomain.name}] 점수가 초기화되었습니다.`);

    if (appState.settings.gasApiUrl) {
      callGasApi('RESET_CLASS_DATA', {
        semester: sem,
        targetClass: appState.activeClass.replace(/[^0-9]/g, ''),
        domainMode: 'SINGLE',
        domainId: curDomain.name
      }).catch(() => {});
    }
  });

  document.getElementById('btnConfirmResetAllDomains')?.addEventListener('click', () => {
    if (!confirm(`⚠️ 경고: [${appState.activeClass}]의 모든 평가 영역 점수를 완전히 초기화하시겠습니까?`)) return;
    pushHistorySnapshot();

    const sem = appState.currentSemester;
    const students = appState.database[sem]?.students || [];
    const classIds = new Set(students.filter(s => s.classNum === appState.activeClass).map(s => s.id));

    Object.keys(appState.database[sem].records || {}).forEach(k => {
      const studentId = k.split('_')[0];
      if (classIds.has(studentId)) {
        delete appState.database[sem].records[k];
      }
    });

    markDirty(true);
    saveLocalState();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast(`${appState.activeClass} 전체 평가종목 점수가 초기화되었습니다.`);

    if (appState.settings.gasApiUrl) {
      callGasApi('RESET_CLASS_DATA', {
        semester: sem,
        targetClass: appState.activeClass.replace(/[^0-9]/g, ''),
        domainMode: 'ALL'
      }).catch(() => {});
    }
  });
}

// --------------------------------------------------------------------------
// 14. 가로 탭 바 기반 평가 영역 에디터 (순서 이동/복사 & 범위형 배점표)
// --------------------------------------------------------------------------
function renderDomainEditorLayout() {
  const tabsBar = document.getElementById('domainEditorTabsBar');
  const cardContainer = document.getElementById('domainEditorCardContainer');
  if (!tabsBar || !cardContainer) return;

  tabsBar.innerHTML = '';
  appState.settings.domains.forEach((d, idx) => {
    const pill = document.createElement('button');
    pill.className = `domain-tab-pill ${idx === appState.activeSettingsDomainIdx ? 'active' : ''}`;
    pill.textContent = d.shortName || d.name;
    pill.onclick = () => {
      appState.activeSettingsDomainIdx = idx;
      renderDomainEditorLayout();
    };
    tabsBar.appendChild(pill);
  });

  const activeDomain = appState.settings.domains[appState.activeSettingsDomainIdx] || appState.settings.domains[0];
  const dIdx = appState.activeSettingsDomainIdx;

  const criteriaRowsHtml = (activeDomain.criteria || []).map((c, cIdx) => {
    const min = c.minCount !== undefined ? c.minCount : (c.count !== undefined ? c.count : 0);
    const max = c.maxCount !== undefined ? c.maxCount : (c.count !== undefined ? c.count : min);
    return `
      <div class="tier-range-row">
        <input type="number" value="${min}" onchange="updateCriteriaMinCount(${dIdx}, ${cIdx}, this.value)" class="tier-range-input" title="최소 횟수"> ~ 
        <input type="number" value="${max}" onchange="updateCriteriaMaxCount(${dIdx}, ${cIdx}, this.value)" class="tier-range-input" title="최대 횟수"> 회 = 
        <input type="number" value="${c.score}" onchange="updateCriteriaTierScore(${dIdx}, ${cIdx}, this.value)" class="tier-range-input" style="font-weight:900;" title="배점"> 점
        <button class="btn-step-order" onclick="moveCriteriaTierOrder(${dIdx}, ${cIdx}, -1)" title="위로">▲</button>
        <button class="btn-step-order" onclick="moveCriteriaTierOrder(${dIdx}, ${cIdx}, 1)" title="아래로">▼</button>
        <button class="btn-step-order" onclick="copyCriteriaTier(${dIdx}, ${cIdx})" title="구간 복사">복사</button>
        <button onclick="deleteCriteriaTier(${dIdx}, ${cIdx})" style="color:var(--danger);font-weight:bold;margin-left:2px;">✕</button>
      </div>
    `;
  }).join('');

  cardContainer.innerHTML = `
    <div class="domain-setting-card">
      <div class="domain-card-header">
        <input type="text" value="${activeDomain.name}" onchange="updateDomainName(${dIdx}, this.value)" style="font-weight:900;font-size:0.84rem;border:1px solid var(--border-color);border-radius:4px;padding:2px 6px;width:55%;">
        <div class="domain-action-tools">
          <button class="btn-step-order" onclick="moveDomainOrder(${dIdx}, -1)" title="영역 위로 이동">▲</button>
          <button class="btn-step-order" onclick="moveDomainOrder(${dIdx}, 1)" title="영역 아래로 이동">▼</button>
          <button class="btn-tool-sub" onclick="copyDomainConfig(${dIdx})" style="padding:2px 6px;font-size:0.7rem;">복사</button>
          <button class="btn-danger-outline" onclick="deleteDomainConfig(${dIdx})" style="padding:2px 6px;font-size:0.7rem;">삭제</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:0.74rem;">
        <span style="color:var(--text-muted);">약칭:</span>
        <input type="text" value="${activeDomain.shortName || ''}" onchange="updateDomainShortName(${dIdx}, this.value)" style="width:70px;border:1px solid var(--border-color);border-radius:4px;padding:1px 4px;">
        <span style="color:var(--text-muted);margin-left:4px;">만점:</span>
        <input type="number" value="${activeDomain.maxScore}" onchange="updateDomainMax(${dIdx}, this.value)" style="width:40px;border:1px solid var(--border-color);border-radius:4px;text-align:center;">
        <span style="color:var(--text-muted);margin-left:4px;">결석:</span>
        <input type="number" value="${activeDomain.absentScore}" onchange="updateDomainAbsent(${dIdx}, this.value)" style="width:40px;border:1px solid var(--border-color);border-radius:4px;text-align:center;">
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
        <span style="font-size:0.72rem;font-weight:800;color:var(--text-muted);">범위형 극간 배점표:</span>
        <button class="btn-tool-sub" onclick="addCriteriaTier(${dIdx})" style="padding:1px 6px;font-size:0.68rem;">+ 구간 추가</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">
        ${criteriaRowsHtml}
      </div>
    </div>
  `;
}

window.moveDomainOrder = function(idx, dir) {
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= appState.settings.domains.length) return;
  const temp = appState.settings.domains[idx];
  appState.settings.domains[idx] = appState.settings.domains[targetIdx];
  appState.settings.domains[targetIdx] = temp;
  appState.activeSettingsDomainIdx = targetIdx;
  renderDomainEditorLayout();
  renderDomainTabs();
};

window.copyDomainConfig = function(idx) {
  const src = appState.settings.domains[idx];
  const newDomain = JSON.parse(JSON.stringify(src));
  newDomain.id = `domain_${Date.now()}`;
  newDomain.name = `${src.name} (복사본)`;
  newDomain.shortName = `${(src.shortName || src.name).slice(0, 4)}복사`;
  appState.settings.domains.splice(idx + 1, 0, newDomain);
  appState.activeSettingsDomainIdx = idx + 1;
  renderDomainEditorLayout();
  renderDomainTabs();
  showToast(`[${src.shortName || src.name}] 영역이 복사되었습니다.`);
};

window.deleteDomainConfig = function(idx) {
  if (appState.settings.domains.length <= 1) {
    alert("최소 1개 이상의 평가 영역이 필요합니다.");
    return;
  }
  if (!confirm("이 평가 영역을 삭제하시겠습니까?")) return;
  appState.settings.domains.splice(idx, 1);
  appState.activeSettingsDomainIdx = Math.max(0, idx - 1);
  appState.activeDomainId = appState.settings.domains[0].id;
  renderDomainEditorLayout();
  renderDomainTabs();
};

window.updateDomainName = (idx, val) => { appState.settings.domains[idx].name = val.trim(); };
window.updateDomainShortName = (idx, val) => { appState.settings.domains[idx].shortName = val.trim(); };
window.updateDomainMax = (idx, val) => { appState.settings.domains[idx].maxScore = parseInt(val) || 20; };
window.updateDomainAbsent = (idx, val) => { appState.settings.domains[idx].absentScore = parseInt(val) || 0; };

window.updateCriteriaMinCount = (dIdx, cIdx, val) => {
  appState.settings.domains[dIdx].criteria[cIdx].minCount = parseInt(val) || 0;
};
window.updateCriteriaMaxCount = (dIdx, cIdx, val) => {
  appState.settings.domains[dIdx].criteria[cIdx].maxCount = parseInt(val) || 0;
};
window.updateCriteriaTierScore = (dIdx, cIdx, val) => {
  appState.settings.domains[dIdx].criteria[cIdx].score = parseInt(val) || 0;
};
window.moveCriteriaTierOrder = (dIdx, cIdx, dir) => {
  const target = cIdx + dir;
  const list = appState.settings.domains[dIdx].criteria;
  if (target < 0 || target >= list.length) return;
  const temp = list[cIdx];
  list[cIdx] = list[target];
  list[target] = temp;
  renderDomainEditorLayout();
};
window.copyCriteriaTier = (dIdx, cIdx) => {
  const src = appState.settings.domains[dIdx].criteria[cIdx];
  appState.settings.domains[dIdx].criteria.splice(cIdx + 1, 0, { ...src });
  renderDomainEditorLayout();
};
window.addCriteriaTier = (dIdx) => {
  appState.settings.domains[dIdx].criteria.push({ minCount: 0, maxCount: 0, score: 0 });
  renderDomainEditorLayout();
};
window.deleteCriteriaTier = (dIdx, cIdx) => {
  appState.settings.domains[dIdx].criteria.splice(cIdx, 1);
  renderDomainEditorLayout();
};

// --------------------------------------------------------------------------
// 15. NEIS 클립보드 원터치 복사 & 플로팅 스톱워치
// --------------------------------------------------------------------------
function initNeisClipboardCopy() {
  document.getElementById('btnCopyNeisClipboard')?.addEventListener('click', () => {
    const sem = appState.currentSemester;
    const curDomain = getCurrentDomain();
    const currentStudents = (appState.database[sem]?.students || [])
      .filter(s => s.classNum === appState.activeClass)
      .sort((a, b) => a.num - b.num);

    if (currentStudents.length === 0) return alert("복사할 학생 데이터가 없습니다.");

    // TSV 포맷 구성
    let tsv = "반\t번호\t성명\t점수\n";
    currentStudents.forEach(st => {
      const rec = getStudentRecord(st.id, curDomain.id);
      const scoreStr = rec.finalScore !== null ? rec.finalScore : '';
      tsv += `${st.classNum.replace(/[^0-9]/g, '')}\t${st.num}\t${st.name}\t${scoreStr}\n`;
    });

    navigator.clipboard.writeText(tsv).then(() => {
      showToast(`${appState.activeClass} [${curDomain.shortName}] NEIS 점수가 클립보드에 복사되었습니다! 📑`);
    }).catch(err => alert("클립보드 복사 실패: " + err));
  });
}

function initStopwatchWidget() {
  const widget = document.getElementById('stopwatchWidget');
  const btnToggle = document.getElementById('btnToggleStopwatch');
  const btnClose = document.getElementById('btnCloseStopwatch');
  const dispTime = document.getElementById('dispStopwatchTime');
  const btnStart = document.getElementById('btnStopwatchStart');
  const btnReset = document.getElementById('btnStopwatchReset');

  btnToggle?.addEventListener('click', () => {
    widget.classList.toggle('hidden');
    feedbackAction('tap');
  });

  btnClose?.addEventListener('click', () => widget.classList.add('hidden'));

  btnStart?.addEventListener('click', () => {
    if (!isStopwatchRunning) {
      isStopwatchRunning = true;
      stopwatchStartTime = Date.now() - stopwatchElapsed;
      btnStart.textContent = "정지";
      btnStart.classList.add('running');
      stopwatchInterval = setInterval(() => {
        stopwatchElapsed = Date.now() - stopwatchStartTime;
        updateStopwatchDisplay(stopwatchElapsed);
      }, 50);
    } else {
      isStopwatchRunning = false;
      clearInterval(stopwatchInterval);
      btnStart.textContent = "시작";
      btnStart.classList.remove('running');
    }
  });

  btnReset?.addEventListener('click', () => {
    clearInterval(stopwatchInterval);
    isStopwatchRunning = false;
    stopwatchElapsed = 0;
    btnStart.textContent = "시작";
    btnStart.classList.remove('running');
    if (dispTime) dispTime.textContent = "00:00.0";
  });
}

function updateStopwatchDisplay(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const d = Math.floor((ms % 1000) / 100);
  const str = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
  const disp = document.getElementById('dispStopwatchTime');
  if (disp) disp.textContent = str;
}

// --------------------------------------------------------------------------
// 16. 가변 스플리터 리사이저 & 모바일 세그먼트 전환
// --------------------------------------------------------------------------
function initSplitter() {
  const splitter = document.getElementById('workspaceSplitter');
  if (!splitter) return;
  let isDragging = false;

  splitter.addEventListener('mousedown', () => {
    isDragging = true;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newWidth = Math.min(520, Math.max(280, e.clientX));
    document.documentElement.style.setProperty('--roster-width', `${newWidth}px`);
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      splitter.classList.remove('dragging');
      document.body.style.cursor = '';
    }
  });

  // 터치 조작 지원
  splitter.addEventListener('touchstart', () => {
    isDragging = true;
    splitter.classList.add('dragging');
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isDragging || !e.touches[0]) return;
    const newWidth = Math.min(520, Math.max(280, e.touches[0].clientX));
    document.documentElement.style.setProperty('--roster-width', `${newWidth}px`);
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
      splitter.classList.remove('dragging');
    }
  });
}

function setMobileView(view) {
  document.documentElement.setAttribute('data-mobile-view', view);
  document.getElementById('btnMobileViewRoster')?.classList.toggle('active', view === 'roster');
  document.getElementById('btnMobileViewMeasure')?.classList.toggle('active', view === 'measure');
}

// --------------------------------------------------------------------------
// 17. 구글 시트 백엔드 통신 & 일괄 저장 (SAVE_CLASS_SCORES_BATCH)
// --------------------------------------------------------------------------
async function callGasApi(action, payload = {}) {
  const url = appState.settings.gasApiUrl;
  if (!url) throw new Error("GAS API URL이 등록되지 않았습니다.");

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, ...payload })
  });
  return await res.json();
}

async function fetchCloudDatabase(showToastNotice = true) {
  if (!appState.settings.gasApiUrl) return;
  try {
    const res = await callGasApi('GET_INITIAL_DATA', { semester: appState.currentSemester });
    if (res && res.success && res.students && res.students.length > 0) {
      const sem = appState.currentSemester;
      if (!appState.database[sem]) appState.database[sem] = { students: [], records: {} };

      // 학생 명단 동기화
      appState.database[sem].students = res.students.map(st => ({
        id: st.id,
        classNum: st.classNum,
        num: st.num,
        name: st.name,
        photoUrl: st.photoUrl || ''
      }));

      // 성적 기록 동기화
      if (res.records) {
        appState.database[sem].records = Object.assign({}, appState.database[sem].records, res.records);
      }

      if (res.classes && res.classes.length > 0) {
        appState.settings.classes = res.classes;
      }

      saveLocalState();
      renderClassTabs();
      renderStudentList();
      updateActiveStudentPanel();
      if (showToastNotice) showToast("구글 시트 중앙 DB와 실시간 동기화 완료! ☁️");
    }
  } catch (e) {
    console.warn("클라우드 자동 로드 실패:", e);
  }
}

async function saveAllToGoogleSheets() {
  const url = appState.settings.gasApiUrl;
  if (!url) {
    alert("먼저 [설정] 창에서 구글 앱스 스크립트(GAS) Web App API URL을 등록해주세요!");
    openModal('settingsModal');
    return;
  }

  const btn = document.getElementById('btnSaveAll');
  const text = document.getElementById('saveBtnText');
  if (btn) btn.disabled = true;
  if (text) text.textContent = "저장중...";

  try {
    const sem = appState.currentSemester;
    const currentStudents = (appState.database[sem]?.students || []).filter(s => s.classNum === appState.activeClass);
    const updates = [];

    currentStudents.forEach(st => {
      appState.settings.domains.forEach((d, dSeq) => {
        const r = getStudentRecord(st.id, d.id);
        updates.push({
          number: st.num,
          domainSeq: dSeq,
          excelHeader: d.excelHeader || d.shortName || d.name,
          t1: r.t1,
          t2: r.t2,
          finalScore: r.finalScore,
          memo: r.memo || ''
        });
      });
    });

    const payload = {
      semester: sem,
      gradeClass: appState.activeClass.replace(/[^0-9]/g, ''),
      updates: updates,
      config: appState.settings
    };

    const res = await callGasApi('SAVE_CLASS_SCORES_BATCH', payload);

    if (res && res.success) {
      markDirty(false);
      showToast(`${appState.activeClass} 학생 성적이 구글 시트에 안전하게 영구 저장되었습니다! 💾`);
      feedbackAction('success');
    } else {
      alert("시트 저장 오류: " + (res.error || '응답 오류'));
    }
  } catch (err) {
    alert("구글 시트 통신 오류: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (text) text.textContent = "시트저장";
  }
}

// --------------------------------------------------------------------------
// 18. 키패드 독 제어 및 공통 헬퍼
// --------------------------------------------------------------------------
function toggleBottomKeypadDock() {
  const dock = document.getElementById('bottomKeypadDock');
  const text = document.getElementById('dockHandleText');
  const scrollWrap = document.getElementById('measurementScrollContent');
  if (!dock) return;

  appState.isDockCollapsed = !appState.isDockCollapsed;
  if (appState.isDockCollapsed) {
    dock.classList.add('dock-collapsed');
    if (text) text.textContent = "키패드 펼치기";
    if (scrollWrap) scrollWrap.style.paddingBottom = "30px";
  } else {
    dock.classList.remove('dock-collapsed');
    if (text) text.textContent = "키패드 접기";
    if (scrollWrap) scrollWrap.style.paddingBottom = "180px";
  }
  feedbackAction('tap');
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
}

function showToast(message, duration = 2600) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `<i data-lucide="info" style="width:14px;height:14px;color:var(--primary);"></i> <span>${message}</span>`;
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// --------------------------------------------------------------------------
// 19. 환경설정 모달 & 백업/복원
// --------------------------------------------------------------------------
function initSettingsModal() {
  document.getElementById('btnOpenSettings')?.addEventListener('click', () => {
    syncSettingsUI();
    renderDomainEditorLayout();
    openModal('settingsModal');
  });

  document.getElementById('btnTestApiConnection')?.addEventListener('click', async () => {
    const url = document.getElementById('gasApiUrlInput')?.value.trim();
    if (!url) return alert("GAS 엔드포인트 URL을 입력하세요.");
    const btn = document.getElementById('btnTestApiConnection');
    btn.textContent = "테스트 중...";
    try {
      const res = await fetch(`${url}?action=PING&_t=${Date.now()}`);
      const json = await res.json();
      if (json && json.status === 'PONG') {
        alert(`구글 앱스 스크립트(GAS) Web App API와 정상 연결되었습니다! (${json.version || 'ONLINE'}) 🚀`);
      } else {
        alert("응답 형식이 올바르지 않습니다.");
      }
    } catch (e) {
      alert("API 연결 실패: 배포 권한이 '모든 사람(Anyone)'으로 설정되었는지 확인하세요.");
    } finally {
      btn.textContent = "연결 테스트";
    }
  });

  renderThemeColorsPicker();
  renderBgStylePicker();

  document.getElementById('btnAddNewDomain')?.addEventListener('click', () => {
    const name = prompt("추가할 신규 평가 영역명을 입력하세요:");
    if (!name || !name.trim()) return;
    const id = `domain_${Date.now()}`;
    appState.settings.domains.push({
      id,
      name: name.trim(),
      shortName: name.trim().slice(0, 5),
      excelHeader: name.trim(),
      maxScore: 20,
      absentScore: 7,
      criteria: [
        { minCount: 8, maxCount: 10, score: 20 },
        { minCount: 7, maxCount: 7, score: 18 },
        { minCount: 6, maxCount: 6, score: 16 },
        { minCount: 5, maxCount: 5, score: 14 },
        { minCount: 3, maxCount: 4, score: 12 },
        { minCount: 0, maxCount: 2, score: 10 }
      ]
    });
    appState.activeSettingsDomainIdx = appState.settings.domains.length - 1;
    renderDomainEditorLayout();
    renderDomainTabs();
  });

  document.getElementById('btnSaveAllSettings')?.addEventListener('click', () => {
    appState.settings.appTitle = document.getElementById('appMainTitleInput')?.value.trim() || '수행평가 입력기 Pro';
    appState.settings.gasApiUrl = document.getElementById('gasApiUrlInput')?.value.trim() || defaultSettings.gasApiUrl;
    appState.settings.font = document.getElementById('fontFamilySelector')?.value || 'pretendard';

    saveLocalState();
    applyVisualSettings();
    updateMainTitleDisplay();
    renderDomainTabs();
    closeAllModals();
    showToast("환경설정이 성공적으로 저장 및 적용되었습니다.");

    if (appState.settings.gasApiUrl) {
      callGasApi('SAVE_CONFIG', { config: appState.settings }).catch(() => {});
    }
  });

  initFullBackupEngine();
}

function syncSettingsUI() {
  const urlInput = document.getElementById('gasApiUrlInput');
  const fontSel = document.getElementById('fontFamilySelector');
  const titleInput = document.getElementById('appMainTitleInput');
  if (titleInput) titleInput.value = appState.settings.appTitle || '수행평가 입력기 Pro';
  if (urlInput) urlInput.value = appState.settings.gasApiUrl || defaultSettings.gasApiUrl;
  if (fontSel) fontSel.value = appState.settings.font || 'pretendard';
}

function renderThemeColorsPicker() {
  const container = document.getElementById('themeColorGrid');
  if (!container) return;
  const themes = [
    { key: 'indigo', color: '#4f46e5' }, { key: 'emerald', color: '#059669' },
    { key: 'sky', color: '#0284c7' }, { key: 'teal', color: '#0d9488' },
    { key: 'violet', color: '#7c3aed' }, { key: 'fuchsia', color: '#c026d3' },
    { key: 'rose', color: '#e11d48' }, { key: 'amber', color: '#d97706' },
    { key: 'orange', color: '#ea580c' }, { key: 'lime', color: '#65a30d' },
    { key: 'slate', color: '#334155' }, { key: 'zinc', color: '#52525b' }
  ];

  container.innerHTML = themes.map(t => `
    <button class="theme-color-btn ${appState.settings.theme === t.key ? 'active' : ''}" data-theme="${t.key}" style="background-color: ${t.color};" onclick="setAppTheme('${t.key}')"></button>
  `).join('');
}

function renderBgStylePicker() {
  const container = document.getElementById('bgStyleGrid');
  if (!container) return;
  const bgs = [
    { key: 'slate', label: '슬레이트', color: '#f1f5f9' },
    { key: 'cream', label: '크림베이지', color: '#faf7f2' },
    { key: 'mint', label: '산뜻민트', color: '#f0fdf4' },
    { key: 'sky', label: '아이스블루', color: '#f0f9ff' },
    { key: 'lavender', label: '라벤더', color: '#faf5ff' },
    { key: 'dark', label: '다크모드', color: '#151d2e' }
  ];

  container.innerHTML = bgs.map(b => `
    <button class="btn-tool-sub ${appState.settings.bg === b.key ? 'active' : ''}" onclick="setAppBg('${b.key}')">
      <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background-color:${b.color};border:1px solid #ccc;"></span>
      ${b.label}
    </button>
  `).join('');
}

window.setAppTheme = function(themeKey) {
  appState.settings.theme = themeKey;
  applyVisualSettings();
  renderThemeColorsPicker();
};

window.setAppBg = function(bgKey) {
  appState.settings.bg = bgKey;
  applyVisualSettings();
  renderBgStylePicker();
};

function applyVisualSettings() {
  const html = document.documentElement;
  html.setAttribute('data-theme', appState.settings.theme || 'indigo');
  html.setAttribute('data-bg', appState.settings.bg || 'slate');
  html.setAttribute('data-font', appState.settings.font || 'pretendard');
}

// 사진 데이터 일체형 JSON 무손실 백업
function initFullBackupEngine() {
  document.getElementById('btnExportFullJson')?.addEventListener('click', async () => {
    showToast("사진 데이터 패키징 중...");

    const sem = appState.currentSemester;
    const backupDb = JSON.parse(JSON.stringify(appState.database));

    // IndexedDB에 보관된 고화질 Base64 사진을 JSON에 전부 병합
    if (backupDb[sem]?.students) {
      for (const st of backupDb[sem].students) {
        const idbPhoto = await getPhotoFromIDB(st.id);
        if (idbPhoto) st.photoUrl = idbPhoto;
      }
    }

    const fullBackup = {
      version: APP_VERSION,
      exportDate: new Date().toISOString(),
      currentSemester: appState.currentSemester,
      semesters: appState.semesters,
      settings: appState.settings,
      database: backupDb
    };

    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `[수행평가전체백업]_${appState.currentSemester}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("학생 사진까지 통째로 포함된 무손실 JSON 백업 완료! 🛡️");
  });

  document.getElementById('importJsonFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm("백업 파일을 불러오면 현재 데이터가 대체됩니다. 계속하시겠습니까?")) {
      e.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (parsed.database) {
        appState.database = parsed.database;
        appState.semesters = parsed.semesters || appState.semesters;
        appState.currentSemester = parsed.currentSemester || appState.semesters[0];
        if (parsed.settings) appState.settings = Object.assign({}, defaultSettings, parsed.settings);

        // 복원된 사진을 IndexedDB에 재저장
        const sem = appState.currentSemester;
        if (appState.database[sem]?.students) {
          for (const st of appState.database[sem].students) {
            if (st.photoUrl && st.photoUrl.startsWith('data:image')) {
              await savePhotoToIDB(st.id, st.photoUrl);
            }
          }
        }
      }

      saveLocalState();
      applyVisualSettings();
      updateMainTitleDisplay();
      updateSemesterHeaderDisplay();
      renderClassTabs();
      renderDomainTabs();
      selectFirstStudentInClass();
      closeAllModals();
      showToast("학생 사진까지 1초 만에 완벽히 복원되었습니다! 🚀");
    } catch (err) {
      alert("백업 파일 복원 오류: " + err.message);
    }
  });
}

// --------------------------------------------------------------------------
// 20. 앱 부트스트랩 및 이벤트 리스너 바인딩
// --------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  await initLocalStorageData();

  updateSemesterHeaderDisplay();
  renderClassTabs();
  renderDomainTabs();
  updateUndoRedoButtons();
  selectFirstStudentInClass();

  // 모달 닫기
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      closeModal(targetId);
    });
  });

  // Undo / Redo 바인딩
  document.getElementById('btnUndo')?.addEventListener('click', applyUndo);
  document.getElementById('btnRedo')?.addEventListener('click', applyRedo);
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) applyRedo();
      else applyUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      applyRedo();
    }
  });

  // TTS 음성 토글 버튼
  document.getElementById('btnToggleTts')?.addEventListener('click', () => {
    appState.ttsEnabled = !appState.ttsEnabled;
    const btn = document.getElementById('btnToggleTts');
    btn.setAttribute('data-tts', appState.ttsEnabled ? 'on' : 'off');
    showToast(appState.ttsEnabled ? "음성 카운트가 켜졌습니다. 🔊" : "음성 카운트가 꺼졌습니다. 🔇");
    feedbackAction('tap');
  });

  // 모바일 뷰 전환 버튼
  document.getElementById('btnMobileViewRoster')?.addEventListener('click', () => setMobileView('roster'));
  document.getElementById('btnMobileViewMeasure')?.addEventListener('click', () => setMobileView('measure'));

  // 마감 잠금 토글
  document.getElementById('btnToggleDomainLock')?.addEventListener('click', toggleDomainLock);

  // 헤더 모달 버튼들
  document.getElementById('btnOpenDashboard')?.addEventListener('click', openDashboard);
  document.getElementById('btnOpenVbaModal')?.addEventListener('click', () => openModal('vbaGuideModal'));
  document.getElementById('btnOpenDataCenter')?.addEventListener('click', () => {
    updateSemesterDropdown();
    openModal('dataCenterModal');
  });
  document.getElementById('btnOpenIntegratedRoster')?.addEventListener('click', () => openModal('integratedRosterModal'));
  document.getElementById('btnSaveAll')?.addEventListener('click', saveAllToGoogleSheets);
  document.getElementById('semesterPill')?.addEventListener('click', () => {
    updateSemesterDropdown();
    openModal('dataCenterModal');
  });

  // 신규 반 수동 추가
  document.getElementById('btnAddNewClass')?.addEventListener('click', () => {
    const name = prompt("추가할 신규 학급명을 입력하세요 (예: 6반):");
    if (!name || !name.trim()) return;
    const formatted = name.trim().includes('반') ? name.trim() : `${name.trim()}반`;
    if (!appState.settings.classes.includes(formatted)) {
      appState.settings.classes.push(formatted);
      appState.settings.classes.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
      appState.activeClass = formatted;
      saveLocalState();
      renderClassTabs();
      selectFirstStudentInClass();
      showToast(`신규 학급 [${formatted}]이 추가되었습니다.`);
    }
  });

  // 검색 & 필터
  const searchInput = document.getElementById('studentSearchInput');
  const btnClear = document.getElementById('btnClearSearch');
  searchInput?.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value.trim();
    if (btnClear) btnClear.classList.toggle('hidden', !appState.searchQuery);
    renderStudentList();
  });
  btnClear?.addEventListener('click', () => {
    searchInput.value = '';
    appState.searchQuery = '';
    btnClear.classList.add('hidden');
    renderStudentList();
  });

  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.activeFilter = btn.getAttribute('data-filter');
      renderStudentList();
    });
  });

  // 시기 선택
  document.querySelectorAll('#trialSegment .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.activeTrial = Number(btn.getAttribute('data-trial'));
      feedbackAction('tap');
      updateActiveStudentPanel();
    });
  });

  // 키패드 바인딩
  document.querySelectorAll('.count-key').forEach(btn => {
    btn.addEventListener('click', () => handleKeypadInput(btn.getAttribute('data-value')));
  });
  document.getElementById('btnKeyPass')?.addEventListener('click', () => handleKeypadInput('pass'));
  document.getElementById('btnKeyAbsent')?.addEventListener('click', () => handleKeypadInput('absent'));
  document.getElementById('btnKeyClear')?.addEventListener('click', () => handleKeypadInput('clear'));

  // 학생 순차 이동
  document.getElementById('btnPrevStudent')?.addEventListener('click', () => {
    feedbackAction('tap');
    moveToNextStudent(-1);
  });
  document.getElementById('btnNextStudent')?.addEventListener('click', () => {
    feedbackAction('tap');
    moveToNextStudent(1);
  });

  // 키패드 독 접기/펼치기
  document.getElementById('btnToggleKeypadDock')?.addEventListener('click', toggleBottomKeypadDock);

  // 개별 모듈 초기화
  document.getElementById('btnOpenPhotoStudio')?.addEventListener('click', openPhotoStudio);
  initCanvasStudioEvents();
  initIntegratedRosterUploader();
  initTemplateModal();
  initPhotoCorrectionModal();
  initClassResetModal();
  initMemoModal();
  initStudentManager();
  initDataCenter();
  initSettingsModal();
  initNeisClipboardCopy();
  initStopwatchWidget();
  initSplitter();

  if (window.lucide) lucide.createIcons();
});
