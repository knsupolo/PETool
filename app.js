/* ==========================================================================
   수행평가 입력기 Pro (v4.1 Pro) - 핵심 통합 제어 엔진 (app.js)
   - 버전 체계: v4.1 Pro
   - 0ms 반응형 측정 엔진, 1차 만점 2차 자동 패스 & 0ms 커서 이동
   - 눈이 편안한 톤다운 점수대별 차등 배지 & 좌측 1차|2차 인라인 요약
   - 우측 대형 프로필(96~100px) & 데이터 분석 인포그래픽 대시보드
   - 우측 영역에만 종속되는 슬림 접이식 키패드 독 (좌측 명렬표 침범 차단)
   - 통합 명렬표 등록기 (일반 엑셀 + 사진 포함 엑셀 올인원 파서)
   - 반별 점수 원클릭 초기화 (현재 종목 / 전 종목)
   - 평가 영역 순서 이동(▲/▼) 및 복사(Clone)
   - 극간 배점표 범위형(min~max) 매핑, 순서 이동 및 복사
   - 학생 사진(Base64) 일체형 무손실 JSON 전체 백업 및 원클릭 복원
   - GAS Web App RESTful JSON API 연동
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. 전역 상태 관리 (State Management)
// --------------------------------------------------------------------------
const APP_VERSION = 'v4.1 Pro';
const APP_STORAGE_KEY = 'PE_EVAL_PRO_V4_1_DATA';
const SETTINGS_STORAGE_KEY = 'PE_EVAL_PRO_V4_1_SETTINGS';

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
  activeFilter: 'all', // all, done, undone, absent
  searchQuery: '',
  isDirty: false,
  isDockCollapsed: false,
  settings: { ...defaultSettings },
  // { [학기명]: { students: [...], records: { [학번_종목ID]: { t1, t2, finalScore, memo } } } }
  database: {}
};

// Undo / Redo 히스토리 스택
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 30;

// 웹 오디오 엔진
let audioCtx = null;

// 캔버스 사진 스튜디오 전역 변수
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

// --------------------------------------------------------------------------
// 2. 비프음 & 햅틱 피드백 엔진
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

function feedbackAction(type = 'tap') {
  triggerHaptic(type === 'error' ? [30, 40, 30] : (type === 'success' ? [15, 20, 15] : 10));
  if (type === 'tap') playBeep(560, 0.04);
  else if (type === 'success') playBeep(760, 0.08);
  else if (type === 'pass') playBeep(430, 0.05);
  else if (type === 'clear') playBeep(310, 0.05);
  else if (type === 'error') playBeep(220, 0.12, 'sawtooth');
}

// --------------------------------------------------------------------------
// 3. 로컬 스토리지 및 기본 데이터 초기화
// --------------------------------------------------------------------------
function initLocalStorageData() {
  const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (savedSettings) {
    try {
      appState.settings = Object.assign({}, defaultSettings, JSON.parse(savedSettings));
      // 구글 배포 주소 자동 보정
      if (!appState.settings.gasApiUrl) {
        appState.settings.gasApiUrl = defaultSettings.gasApiUrl;
      }
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
}

function ensureSemesterData(semester) {
  if (!appState.database[semester]) {
    appState.database[semester] = {
      students: [],
      records: {}
    };
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

function saveLocalState() {
  const payload = {
    currentSemester: appState.currentSemester,
    semesters: appState.semesters,
    database: appState.database
  };
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(payload));
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appState.settings));
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
// 4. Undo / Redo 스택 엔진
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
// 5. 평가 연산 및 범위형(min~max) 배점 매핑 엔진
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
  // 범위 매핑 지원 (minCount ~ maxCount)
  for (const c of criteria) {
    const min = c.minCount !== undefined ? c.minCount : (c.count !== undefined ? c.count : 0);
    const max = c.maxCount !== undefined ? c.maxCount : (c.count !== undefined ? c.count : min);
    if (numericCount >= min && numericCount <= max) {
      return c.score;
    }
  }

  // 일치하는 구간이 없을 경우 최고/최저 점수 비례 매핑
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
// 6. UI 내비게이션 & 좌측 명렬표 렌더링 (1차|2차 인라인 & 차등 배지)
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

    if (appState.activeFilter === 'done') return isDone;
    if (appState.activeFilter === 'absent') return isAbsent;
    if (appState.activeFilter === 'undone') return isUndone;
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

  // 필터 카운터 갱신
  let doneCnt = 0, absentCnt = 0, undoneCnt = 0;
  allClassStudents.forEach(st => {
    const r = getStudentRecord(st.id, appState.activeDomainId);
    if (r.t1 === -1) absentCnt++;
    else if (r.finalScore !== null) doneCnt++;
    else undoneCnt++;
  });

  const elAll = document.getElementById('cntFilterAll');
  const elDone = document.getElementById('cntFilterDone');
  const elUndone = document.getElementById('cntFilterUndone');
  const elAbsent = document.getElementById('cntFilterAbsent');
  if (elAll) elAll.textContent = allClassStudents.length;
  if (elDone) elDone.textContent = doneCnt;
  if (elUndone) elUndone.textContent = undoneCnt;
  if (elAbsent) elAbsent.textContent = absentCnt;

  filtered.forEach(student => {
    const rec = getStudentRecord(student.id, appState.activeDomainId);
    const isSelected = student.id === appState.selectedStudentId;

    const card = document.createElement('div');
    card.className = `student-card ${isSelected ? 'active-card' : ''}`;
    card.id = `studentCard_${student.id}`;

    // 점수별 톤다운 차등 배지 분류
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
// 7. 활성 학생 측정 패널 & 데이터 분석 인포그래픽 업데이트
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
    updateStudentAnalyticsDashboard(null, domain);
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
  updateStudentAnalyticsDashboard(student, domain);
}

function updateStudentAnalyticsDashboard(student, domain) {
  const targetLabel = document.getElementById('analyticsStudentTargetLabel');
  const diffBadge = document.getElementById('dispClassAvgDiff');
  const avgScoreEl = document.getElementById('dispClassAvgScore');
  const curScoreEl = document.getElementById('dispCurrentStudentScore');
  const avgGauge = document.getElementById('dispClassAvgGauge');
  const improveBadge = document.getElementById('dispTrialImprovement');
  const improveGauge = document.getElementById('dispTrialImproveGauge');
  const improveText = document.getElementById('dispTrialImproveText');
  const compCountText = document.getElementById('dispDomainCompletedCount');
  const badgesContainer = document.getElementById('dispDomainProgressBadges');

  if (!student) {
    if (targetLabel) targetLabel.textContent = "-";
    if (diffBadge) diffBadge.textContent = "-";
    if (avgScoreEl) avgScoreEl.textContent = "0점";
    if (curScoreEl) curScoreEl.textContent = "0점";
    if (avgGauge) avgGauge.style.width = "50%";
    if (improveBadge) improveBadge.textContent = "-";
    if (improveGauge) improveGauge.style.width = "0%";
    if (improveText) improveText.textContent = "학생 선택 대기 중";
    if (compCountText) compCountText.textContent = "0 / 0 영역 완료";
    if (badgesContainer) badgesContainer.innerHTML = '';
    return;
  }

  if (targetLabel) targetLabel.textContent = `${student.name} (${student.classNum})`;

  // 1. 학급 평균 산출 및 대비 위치
  const sem = appState.currentSemester;
  const classStudents = (appState.database[sem]?.students || []).filter(s => s.classNum === student.classNum);
  let classSum = 0;
  let evaluatedCount = 0;

  classStudents.forEach(st => {
    const r = getStudentRecord(st.id, domain.id);
    if (r.finalScore !== null) {
      classSum += r.finalScore;
      evaluatedCount++;
    }
  });

  const classAvg = evaluatedCount > 0 ? (classSum / evaluatedCount) : 0;
  const curRec = getStudentRecord(student.id, domain.id);
  const myScore = curRec.finalScore !== null ? curRec.finalScore : 0;

  if (avgScoreEl) avgScoreEl.textContent = `${classAvg.toFixed(1)}점`;
  if (curScoreEl) curScoreEl.textContent = curRec.finalScore !== null ? `${myScore}점` : '미측정';

  if (curRec.finalScore !== null) {
    const diff = myScore - classAvg;
    const sign = diff > 0 ? '+' : '';
    if (diffBadge) {
      diffBadge.textContent = `평균 대비 ${sign}${diff.toFixed(1)}점`;
      diffBadge.className = `metric-badge ${diff >= 0 ? 'highlight' : ''}`;
    }
    // 게이지 (중앙 50% 기준)
    const max = domain.maxScore || 20;
    const ratio = Math.min(100, Math.max(0, 50 + (diff / max) * 50));
    if (avgGauge) avgGauge.style.width = `${ratio}%`;
  } else {
    if (diffBadge) diffBadge.textContent = "측정 대기";
    if (avgGauge) avgGauge.style.width = "50%";
  }

  // 2. 1차 대비 2차 향상도
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
    if (improveText) improveText.textContent = `1차 시기 최고점 달성으로 2차 패스`;
    if (improveGauge) improveGauge.style.width = "100%";
  } else {
    if (improveBadge) improveBadge.textContent = `-`;
    if (improveText) improveText.textContent = `2차 시기 측정 전`;
    if (improveGauge) improveGauge.style.width = "0%";
  }

  // 3. 전 영역 달성 현황 배지
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
    feedbackAction('pass');
    moveToNextStudent(1);
    return;
  }

  if (value === 'absent') {
    updateStudentRecord(student.id, appState.activeDomainId, { t1: -1, t2: -1 });
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
      feedbackAction('success');
      showToast(`${student.name} 1차 만점! 2차 자동 패스되었습니다.`);
      moveToNextStudent(1);
      return;
    } else {
      updateStudentRecord(student.id, appState.activeDomainId, { t1: count });
      feedbackAction('tap');
      appState.activeTrial = 2;
      renderStudentList();
      updateActiveStudentPanel();
      return;
    }
  } else {
    updateStudentRecord(student.id, appState.activeDomainId, { t2: count });
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
// 8. 캔버스 사진 스튜디오 (Scale X/Y & 8종 필터)
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

  document.getElementById('btnDeleteCurrentAvatar')?.addEventListener('click', () => {
    const student = getSelectedStudent();
    if (!student) return;
    if (confirm("이 학생의 사진을 완전히 삭제하시겠습니까?")) {
      student.photoUrl = '';
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
// 9. 통합 명렬표 등록 모달 (일반 엑셀 명단 & 사진 포함 엑셀 올인원 처리)
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

  document.getElementById('btnOpenVbaFromIntegrated')?.addEventListener('click', () => {
    closeAllModals();
    openModal('vbaGuideModal');
  });
}

async function processIntegratedExcelFile(file) {
  if (!file) return;
  const pWrap = document.getElementById('integratedProgressWrap');
  const pBar = document.getElementById('integratedProgressBar');
  const pText = document.getElementById('integratedProgressText');
  if (pWrap) pWrap.classList.remove('hidden');

  try {
    pText.textContent = "엑셀 구조 분석 중...";
    pBar.style.width = "20%";

    const arrayBuffer = await file.arrayBuffer();

    // 1. 엑셀 워크시트 파싱 및 학생 명단 병합
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
    const newClassSet = new Set(appState.settings.classes);

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[colName]) continue;

      let cVal = colClass !== -1 && row[colClass] ? String(row[colClass]).trim() : appState.activeClass;
      if (!cVal.includes('반')) cVal = `${cVal}반`;
      const numVal = parseInt(row[colNum]) || (r - headerRowIdx);
      const nameVal = String(row[colName]).trim();

      newClassSet.add(cVal);

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

    appState.settings.classes = Array.from(newClassSet).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
    existingStudents.sort((a, b) => (parseInt(a.classNum) || 0) - (parseInt(b.classNum) || 0) || a.num - b.num);

    pBar.style.width = "50%";
    pText.textContent = "사진 포함 여부 검사 중...";

    // 2. JSZip 기반 엑셀 내부 사진 추출 여부 확인
    let photoMatchedCount = 0;
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const mediaFiles = Object.keys(zip.files).filter(f => f.startsWith('xl/media/'));

      if (mediaFiles.length > 0) {
        pText.textContent = `사진 ${mediaFiles.length}장 추출 및 학생 매칭 중...`;
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
          avatarBatch.push({
            number: activeClassStudents[i].num,
            name: activeClassStudents[i].name,
            base64Data: base64Data
          });
          photoMatchedCount++;
          pBar.style.width = `${50 + Math.round((i / activeClassStudents.length) * 45)}%`;
        }

        // 백엔드 비동기 일괄 업로드
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
    } catch (zipErr) {
      // 일반 엑셀 파일일 경우 사진 추출 생략
    }

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
      if (photoMatchedCount > 0) {
        showToast(`명단 ${studentMergedCount}명 병합 및 사진 ${photoMatchedCount}장 일괄 등록 완료! 📸`);
      } else {
        showToast(`명렬표 파일에서 ${studentMergedCount}명의 학생이 성공적으로 병합되었습니다! 📑`);
      }
    }, 600);

  } catch (err) {
    alert("통합 명렬표 등록 오류: " + err.message);
    if (pWrap) pWrap.classList.add('hidden');
  }
}

// --------------------------------------------------------------------------
// 10. 반별 점수 원클릭 초기화 (현재 종목 / 전 종목)
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

  // 1. 현재 종목 초기화
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

  // 2. 현재 반 전 종목 일괄 초기화
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
// 11. 평가 영역 순서 이동(▲/▼), 복사(Clone) 및 범위형 배점표 에디터
// --------------------------------------------------------------------------
function renderDomainEditorList() {
  const container = document.getElementById('domainEditorList');
  if (!container) return;
  container.innerHTML = '';

  appState.settings.domains.forEach((d, idx) => {
    const card = document.createElement('div');
    card.className = 'domain-setting-card';

    // 범위형 배점표 행 렌더링
    const criteriaRowsHtml = d.criteria.map((c, cIdx) => {
      const min = c.minCount !== undefined ? c.minCount : (c.count !== undefined ? c.count : 0);
      const max = c.maxCount !== undefined ? c.maxCount : (c.count !== undefined ? c.count : min);
      return `
        <div class="tier-range-row">
          <input type="number" value="${min}" onchange="updateCriteriaMinCount(${idx}, ${cIdx}, this.value)" class="tier-range-input" title="최소 횟수"> ~ 
          <input type="number" value="${max}" onchange="updateCriteriaMaxCount(${idx}, ${cIdx}, this.value)" class="tier-range-input" title="최대 횟수"> 회 = 
          <input type="number" value="${c.score}" onchange="updateCriteriaTierScore(${idx}, ${cIdx}, this.value)" class="tier-range-input" style="font-weight:900;" title="배점"> 점
          <button class="btn-step-order" onclick="moveCriteriaTierOrder(${idx}, ${cIdx}, -1)" title="위로">▲</button>
          <button class="btn-step-order" onclick="moveCriteriaTierOrder(${idx}, ${cIdx}, 1)" title="아래로">▼</button>
          <button class="btn-step-order" onclick="copyCriteriaTier(${idx}, ${cIdx})" title="구간 복사">복사</button>
          <button onclick="deleteCriteriaTier(${idx}, ${cIdx})" style="color:var(--danger);font-weight:bold;margin-left:2px;">✕</button>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="domain-card-header">
        <input type="text" value="${d.name}" onchange="updateDomainName(${idx}, this.value)" style="font-weight:900;font-size:0.84rem;border:1px solid var(--border-color);border-radius:4px;padding:2px 6px;width:55%;">
        <div class="domain-action-tools">
          <button class="btn-step-order" onclick="moveDomainOrder(${idx}, -1)" title="영역 위로 이동">▲</button>
          <button class="btn-step-order" onclick="moveDomainOrder(${idx}, 1)" title="영역 아래로 이동">▼</button>
          <button class="btn-tool-sub" onclick="copyDomainConfig(${idx})" style="padding:2px 6px;font-size:0.7rem;">복사</button>
          <button class="btn-danger-outline" onclick="deleteDomainConfig(${idx})" style="padding:2px 6px;font-size:0.7rem;">삭제</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:0.74rem;">
        <span style="color:var(--text-muted);">약칭:</span>
        <input type="text" value="${d.shortName || ''}" onchange="updateDomainShortName(${idx}, this.value)" style="width:70px;border:1px solid var(--border-color);border-radius:4px;padding:1px 4px;">
        <span style="color:var(--text-muted);margin-left:4px;">만점:</span>
        <input type="number" value="${d.maxScore}" onchange="updateDomainMax(${idx}, this.value)" style="width:40px;border:1px solid var(--border-color);border-radius:4px;text-align:center;">
        <span style="color:var(--text-muted);margin-left:4px;">결석:</span>
        <input type="number" value="${d.absentScore}" onchange="updateDomainAbsent(${idx}, this.value)" style="width:40px;border:1px solid var(--border-color);border-radius:4px;text-align:center;">
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
        <span style="font-size:0.72rem;font-weight:800;color:var(--text-muted);">범위형 극간 배점표:</span>
        <button class="btn-tool-sub" onclick="addCriteriaTier(${idx})" style="padding:1px 6px;font-size:0.68rem;">+ 구간 추가</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">
        ${criteriaRowsHtml}
      </div>
    `;
    container.appendChild(card);
  });
}

// 영역 순서 이동
window.moveDomainOrder = function(idx, dir) {
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= appState.settings.domains.length) return;
  const temp = appState.settings.domains[idx];
  appState.settings.domains[idx] = appState.settings.domains[targetIdx];
  appState.settings.domains[targetIdx] = temp;
  renderDomainEditorList();
  renderDomainTabs();
};

// 영역 원클릭 복사 (Clone)
window.copyDomainConfig = function(idx) {
  const src = appState.settings.domains[idx];
  const newDomain = JSON.parse(JSON.stringify(src));
  newDomain.id = `domain_${Date.now()}`;
  newDomain.name = `${src.name} (복사본)`;
  newDomain.shortName = `${(src.shortName || src.name).slice(0, 4)}복사`;
  appState.settings.domains.splice(idx + 1, 0, newDomain);
  renderDomainEditorList();
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
  appState.activeDomainId = appState.settings.domains[0].id;
  renderDomainEditorList();
  renderDomainTabs();
};

window.updateDomainName = (idx, val) => { appState.settings.domains[idx].name = val.trim(); };
window.updateDomainShortName = (idx, val) => { appState.settings.domains[idx].shortName = val.trim(); };
window.updateDomainMax = (idx, val) => { appState.settings.domains[idx].maxScore = parseInt(val) || 20; };
window.updateDomainAbsent = (idx, val) => { appState.settings.domains[idx].absentScore = parseInt(val) || 0; };

// 극간 배점표 구간 제어
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
  renderDomainEditorList();
};
window.copyCriteriaTier = (dIdx, cIdx) => {
  const src = appState.settings.domains[dIdx].criteria[cIdx];
  appState.settings.domains[dIdx].criteria.splice(cIdx + 1, 0, { ...src });
  renderDomainEditorList();
};
window.addCriteriaTier = (dIdx) => {
  appState.settings.domains[dIdx].criteria.push({ minCount: 0, maxCount: 0, score: 0 });
  renderDomainEditorList();
};
window.deleteCriteriaTier = (dIdx, cIdx) => {
  appState.settings.domains[dIdx].criteria.splice(cIdx, 1);
  renderDomainEditorList();
};

// --------------------------------------------------------------------------
// 12. 사진 데이터 일체형 무손실 JSON 백업 및 1초 복원
// --------------------------------------------------------------------------
function initBackupRestoreEngine() {
  document.getElementById('btnExportFullJson')?.addEventListener('click', () => {
    // database 내부의 모든 학생 photoUrl(Base64)이 100% 직렬화되어 통째로 포함됨
    const fullBackup = {
      version: APP_VERSION,
      exportDate: new Date().toISOString(),
      currentSemester: appState.currentSemester,
      semesters: appState.semesters,
      settings: appState.settings,
      database: appState.database
    };

    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `[수행평가전체백업]_${appState.currentSemester}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("학생 사진까지 통째로 포함된 무손실 JSON 백업 파일이 저장되었습니다. 🛡️");
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
      } else if (parsed.sheets || parsed.records) {
        const sem = appState.currentSemester;
        appState.database[sem] = {
          students: parsed.students || [],
          records: parsed.records || {}
        };
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
// 13. 관찰 메모 & 학생 명단 관리
// --------------------------------------------------------------------------
function initMemoModal() {
  document.getElementById('btnOpenMemoModal')?.addEventListener('click', () => {
    const student = getSelectedStudent();
    if (!student) return;
    const rec = getStudentRecord(student.id, appState.activeDomainId);

    const titleEl = document.getElementById('memoStudentTitle');
    const inputEl = document.getElementById('studentMemoInput');
    if (titleEl) titleEl.textContent = `${student.classNum} ${student.num}번 ${student.name} (${getCurrentDomain().shortName || getCurrentDomain().name})`;
    if (inputEl) inputEl.value = rec.memo || '';

    openModal('memoModal');
  });

  document.querySelectorAll('.btn-tag').forEach(tagBtn => {
    tagBtn.addEventListener('click', () => {
      const tag = tagBtn.getAttribute('data-tag');
      const inputEl = document.getElementById('studentMemoInput');
      if (inputEl) {
        inputEl.value = inputEl.value ? `${inputEl.value.trim()} ${tag}` : tag;
        inputEl.focus();
      }
    });
  });

  document.getElementById('btnSaveMemo')?.addEventListener('click', () => {
    const student = getSelectedStudent();
    if (!student) return;
    const memoText = document.getElementById('studentMemoInput')?.value.trim() || '';
    updateStudentRecord(student.id, appState.activeDomainId, { memo: memoText });
    closeAllModals();
    renderStudentList();
    updateActiveStudentPanel();
    showToast("관찰 메모가 저장되었습니다.");
  });

  document.getElementById('btnDeleteMemo')?.addEventListener('click', () => {
    const student = getSelectedStudent();
    if (!student) return;
    updateStudentRecord(student.id, appState.activeDomainId, { memo: '' });
    closeAllModals();
    renderStudentList();
    updateActiveStudentPanel();
    showToast("관찰 메모가 삭제되었습니다.");
  });
}

function initStudentManager() {
  document.getElementById('btnOpenStudentManager')?.addEventListener('click', () => {
    renderManageStudentTable();
    openModal('studentManagerModal');
  });

  document.getElementById('btnAddStudentSubmit')?.addEventListener('click', () => {
    const numVal = parseInt(document.getElementById('addStudentNumber')?.value);
    const nameVal = document.getElementById('addStudentName')?.value.trim();

    if (!numVal || !nameVal) {
      alert("번호와 학생 성명을 입력하세요.");
      return;
    }

    const sem = appState.currentSemester;
    const newId = `${appState.activeClass}-${String(numVal).padStart(2, '0')}_${Date.now()}`;
    appState.database[sem].students.push({
      id: newId,
      classNum: appState.activeClass,
      num: numVal,
      name: nameVal,
      photoUrl: ''
    });

    markDirty(true);
    saveLocalState();
    renderManageStudentTable();
    renderStudentList();
    showToast(`전입 학생 [${nameVal}] 등록 완료`);

    document.getElementById('addStudentName').value = '';
    document.getElementById('addStudentNumber').value = numVal + 1;
  });

  document.getElementById('btnRenumberAll')?.addEventListener('click', () => {
    if (!confirm("현재 정렬 순서대로 1번부터 번호를 순차적으로 재부여하시겠습니까?")) return;
    const sem = appState.currentSemester;
    const classStudents = appState.database[sem].students.filter(s => s.classNum === appState.activeClass);
    classStudents.forEach((s, idx) => s.num = idx + 1);
    markDirty(true);
    saveLocalState();
    renderManageStudentTable();
    renderStudentList();
    showToast("1번부터 번호 일괄 정리가 완료되었습니다.");
  });

  document.getElementById('btnApplyStudentChanges')?.addEventListener('click', () => {
    const sem = appState.currentSemester;
    const numInputs = document.querySelectorAll('.table-num-input');
    const nameInputs = document.querySelectorAll('.table-name-input');

    numInputs.forEach(input => {
      const id = input.getAttribute('data-id');
      const st = appState.database[sem].students.find(s => s.id === id);
      if (st) st.num = parseInt(input.value) || st.num;
    });

    nameInputs.forEach(input => {
      const id = input.getAttribute('data-id');
      const st = appState.database[sem].students.find(s => s.id === id);
      if (st) st.name = input.value.trim() || st.name;
    });

    markDirty(true);
    saveLocalState();
    closeAllModals();
    renderStudentList();
    updateActiveStudentPanel();
    showToast("순서 및 수정사항이 반영되었습니다.");
  });
}

function renderManageStudentTable() {
  const tbody = document.getElementById('manageStudentListBody');
  const totalCountEl = document.getElementById('manageTotalCount');
  if (!tbody) return;
  tbody.innerHTML = '';

  const sem = appState.currentSemester;
  const list = (appState.database[sem]?.students || [])
    .filter(s => s.classNum === appState.activeClass)
    .sort((a, b) => a.num - b.num);

  if (totalCountEl) totalCountEl.textContent = list.length;

  list.forEach((st, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align:center;font-weight:bold;">${idx + 1}</td>
      <td style="text-align:center;">${st.classNum}</td>
      <td style="text-align:center;">
        <input type="number" class="table-num-input" value="${st.num}" data-id="${st.id}" style="width:48px;text-align:center;border:1px solid var(--border-color);border-radius:4px;padding:2px;">
      </td>
      <td>
        <input type="text" class="table-name-input" value="${st.name}" data-id="${st.id}" style="width:100%;border:1px solid var(--border-color);border-radius:4px;padding:2px 6px;">
      </td>
      <td style="text-align:center;">
        <button class="btn-step-order" onclick="moveStudentRowOrder('${st.id}', -1)" title="위로">▲</button>
        <button class="btn-step-order" onclick="moveStudentRowOrder('${st.id}', 1)" title="아래로">▼</button>
      </td>
      <td style="text-align:center;">
        <button class="btn-delete-student" onclick="deleteStudentRecord('${st.id}')" style="color:var(--danger);font-weight:bold;">전출</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.moveStudentRowOrder = function(studentId, direction) {
  const sem = appState.currentSemester;
  const students = appState.database[sem].students;
  const currentClassStudents = students.filter(s => s.classNum === appState.activeClass);
  const idx = currentClassStudents.findIndex(s => s.id === studentId);
  const targetIdx = idx + direction;

  if (targetIdx < 0 || targetIdx >= currentClassStudents.length) return;

  const temp = currentClassStudents[idx];
  currentClassStudents[idx] = currentClassStudents[targetIdx];
  currentClassStudents[targetIdx] = temp;

  currentClassStudents.forEach((s, i) => s.num = i + 1);
  renderManageStudentTable();
};

window.deleteStudentRecord = function(studentId) {
  if (!confirm("해당 학생을 전출 처리(명단 삭제)하시겠습니까?")) return;
  const sem = appState.currentSemester;
  appState.database[sem].students = appState.database[sem].students.filter(s => s.id !== studentId);
  markDirty(true);
  saveLocalState();
  renderManageStudentTable();
  renderStudentList();
  showToast("전출 처리가 완료되었습니다.");
};

// --------------------------------------------------------------------------
// 14. 결과 현황 대시보드
// --------------------------------------------------------------------------
function openDashboard() {
  const sem = appState.currentSemester;
  const students = appState.database[sem]?.students || [];
  const curDomain = getCurrentDomain();

  let totalCount = students.length;
  let doneCount = 0;
  let absentCount = 0;
  let pendingCount = 0;

  students.forEach(s => {
    const r = getStudentRecord(s.id, curDomain.id);
    if (r.t1 === -1) absentCount++;
    else if (r.finalScore !== null) doneCount++;
    else pendingCount++;
  });

  const rate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  document.getElementById('statTotalStudents').textContent = `${totalCount}명`;
  document.getElementById('statCompletedStudents').textContent = `${doneCount}명`;
  document.getElementById('statCompletionRate').textContent = `(${rate}%)`;
  document.getElementById('statPendingStudents').textContent = `${pendingCount}명`;
  document.getElementById('statAbsentStudents').textContent = `${absentCount}명`;

  const cardsContainer = document.getElementById('classProgressCardsContainer');
  if (cardsContainer) {
    cardsContainer.innerHTML = '';
    appState.settings.classes.forEach(cName => {
      const cStudents = students.filter(s => s.classNum === cName);
      let cDone = 0;
      let cUndone = [];
      let cAbsent = [];

      cStudents.forEach(st => {
        const r = getStudentRecord(st.id, curDomain.id);
        if (r.t1 === -1) cAbsent.push(st.name);
        else if (r.finalScore !== null) cDone++;
        else cUndone.push(st.name);
      });

      const cRate = cStudents.length > 0 ? Math.round((cDone / cStudents.length) * 100) : 0;

      const card = document.createElement('div');
      card.className = 'class-progress-card';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:0.88rem;">${cName}</strong>
          <span style="font-size:0.78rem;font-weight:900;color:var(--primary);">${cDone} / ${cStudents.length}명 (${cRate}%)</span>
        </div>
        <div class="progress-bar-bg" style="margin-top:4px;">
          <div class="progress-bar-fill" style="width:${cRate}%;"></div>
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;">
          미측정: <span style="color:var(--warning);font-weight:bold;">${cUndone.length > 0 ? cUndone.join(', ') : '없음'}</span>
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);">
          미참여(결석): <span style="color:var(--danger);font-weight:bold;">${cAbsent.length > 0 ? cAbsent.join(', ') : '없음'}</span>
        </div>
        <button class="btn-tool-sub" style="margin-top:6px;width:100%;justify-content:center;" onclick="jumpToClassFromDashboard('${cName}')">이 학급으로 즉시 이동</button>
      `;
      cardsContainer.appendChild(card);
    });
  }

  openModal('dashboardModal');
}

window.jumpToClassFromDashboard = function(cName) {
  appState.activeClass = cName;
  closeAllModals();
  renderClassTabs();
  updateLockUI();
  selectFirstStudentInClass();
};

// --------------------------------------------------------------------------
// 15. 세부기록+NEIS 일체형 엑셀 다운로드 및 역반영 업로드
// --------------------------------------------------------------------------
function initDataCenter() {
  document.getElementById('btnQuickDownload')?.addEventListener('click', () => exportDetailedAndNeisExcel());
  document.getElementById('btnExportDetailExcel')?.addEventListener('click', () => exportDetailedAndNeisExcel());

  document.getElementById('btnSwitchSemester')?.addEventListener('click', () => {
    const sel = document.getElementById('selectSemesterList')?.value;
    if (sel && sel !== appState.currentSemester) {
      appState.currentSemester = sel;
      ensureSemesterData(sel);
      saveLocalState();
      updateSemesterHeaderDisplay();
      renderStudentList();
      updateActiveStudentPanel();
      closeAllModals();
      showToast(`[${sel}] 학기로 전환되었습니다.`);
    }
  });

  document.getElementById('btnOpenNewSemesterDialog')?.addEventListener('click', () => {
    const newName = prompt("신규 생성할 학기 명칭을 입력하세요 (예: 2027학년도 1학기):");
    if (!newName || !newName.trim()) return;
    const trimmed = newName.trim();
    if (appState.semesters.includes(trimmed)) {
      alert("이미 존재하는 학기명입니다.");
      return;
    }

    const copyPrev = confirm("기존 학기의 학생 명렬표를 그대로 복사해서 시작하시겠습니까?\n(점수는 초기화된 상태로 생성됩니다)");
    const prevSem = appState.currentSemester;

    appState.semesters.push(trimmed);
    appState.currentSemester = trimmed;

    let studentsCopy = [];
    if (copyPrev && appState.database[prevSem]?.students) {
      studentsCopy = appState.database[prevSem].students.map(s => ({
        ...s,
        photoUrl: s.photoUrl || ''
      }));
    }

    appState.database[trimmed] = {
      students: studentsCopy,
      records: {}
    };

    saveLocalState();
    updateSemesterHeaderDisplay();
    updateSemesterDropdown();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast(`신규 [${trimmed}] 학기가 개설되었습니다! 🎉`);
  });

  document.getElementById('btnRenameCurrentSemester')?.addEventListener('click', () => {
    const current = appState.currentSemester;
    const newName = prompt("현재 학기의 변경할 명칭을 입력하세요:", current);
    if (!newName || !newName.trim() || newName.trim() === current) return;

    const trimmed = newName.trim();
    const idx = appState.semesters.indexOf(current);
    if (idx !== -1) appState.semesters[idx] = trimmed;

    appState.database[trimmed] = appState.database[current];
    delete appState.database[current];
    appState.currentSemester = trimmed;

    saveLocalState();
    updateSemesterHeaderDisplay();
    updateSemesterDropdown();
    showToast("학기 명칭이 변경되었습니다.");
  });

  document.getElementById('btnDeleteCurrentSemester')?.addEventListener('click', () => {
    if (appState.semesters.length <= 1) {
      alert("최소 1개 이상의 학기가 유지되어야 합니다.");
      return;
    }
    const current = appState.currentSemester;
    if (!confirm(`정말로 [${current}] 학기의 데이터를 영구 삭제하시겠습니까?`)) return;

    delete appState.database[current];
    appState.semesters = appState.semesters.filter(s => s !== current);
    appState.currentSemester = appState.semesters[0];

    saveLocalState();
    updateSemesterHeaderDisplay();
    updateSemesterDropdown();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast("학기 데이터가 완전히 삭제되었습니다.");
  });

  document.getElementById('reverseExcelFileInput')?.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleReverseExcelUpload(e.target.files[0]);
  });
}

function updateSemesterHeaderDisplay() {
  const label = document.getElementById('currentSemesterText');
  if (label) label.textContent = appState.currentSemester;
}

function updateSemesterDropdown() {
  const sel = document.getElementById('selectSemesterList');
  if (!sel) return;
  sel.innerHTML = '';
  appState.semesters.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    if (s === appState.currentSemester) opt.selected = true;
    sel.appendChild(opt);
  });
}

function exportDetailedAndNeisExcel() {
  const sem = appState.currentSemester;
  const currentClassStudents = (appState.database[sem]?.students || [])
    .filter(s => s.classNum === appState.activeClass)
    .sort((a, b) => a.num - b.num);

  const curDomain = getCurrentDomain();
  const domains = appState.settings.domains;

  const detailRows = [
    ['학기', '학급', '번호', '성명', '평가영역', '1차 시기', '2차 시기', '최종 환산점수', '비고(관찰메모)']
  ];
  currentClassStudents.forEach(st => {
    const r = getStudentRecord(st.id, curDomain.id);
    detailRows.push([
      sem,
      st.classNum,
      st.num,
      st.name,
      curDomain.name,
      r.t1 !== null ? (r.t1 === -1 ? '결석' : r.t1) : '',
      r.t2 !== null ? (r.t2 === -1 ? '결석' : (r.t2 === 'pass' ? '패스' : r.t2)) : '',
      r.finalScore !== null ? r.finalScore : '',
      r.memo || ''
    ]);
  });

  const neisHeader = ['반', '번호', '성명'];
  domains.forEach(d => neisHeader.push(`${d.excelHeader || d.shortName || d.name}(${d.maxScore})`));
  const neisRows = [neisHeader];

  currentClassStudents.forEach(st => {
    const row = [st.classNum.replace(/[^0-9]/g, ''), st.num, st.name];
    domains.forEach(d => {
      const r = getStudentRecord(st.id, d.id);
      row.push(r.finalScore !== null ? r.finalScore : '');
    });
    neisRows.push(row);
  });

  const wb = XLSX.utils.book_new();
  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  const wsNeis = XLSX.utils.aoa_to_sheet(neisRows);

  XLSX.utils.book_append_sheet(wb, wsDetail, "세부측정기록");
  XLSX.utils.book_append_sheet(wb, wsNeis, "NEIS일괄등록");

  const fileName = `[수행평가]_${appState.activeClass}_${curDomain.shortName || curDomain.name}_${Date.now()}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`${appState.activeClass} 엑셀 다운로드 완료! 📊`);
}

async function handleReverseExcelUpload(file) {
  if (!file) return;
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

    if (rows.length < 2) {
      alert("엑셀 데이터가 비어 있습니다.");
      return;
    }

    pushHistorySnapshot();
    const sem = appState.currentSemester;
    const domain = getCurrentDomain();
    let updatedCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 4) continue;
      const cNum = String(r[1]).includes('반') ? String(r[1]) : `${r[1]}반`;
      const num = parseInt(r[2]);
      const t1Raw = r[5];
      const t2Raw = r[6];
      const memo = r[8] || '';

      const st = (appState.database[sem]?.students || []).find(s => s.classNum === cNum && s.num === num);
      if (st) {
        let t1 = (t1Raw === '결석' || t1Raw === -1) ? -1 : (t1Raw !== undefined && t1Raw !== '' ? Number(t1Raw) : null);
        let t2 = (t2Raw === '결석' || t2Raw === -1) ? -1 : ((t2Raw === '패스' || t2Raw === '-') ? 'pass' : (t2Raw !== undefined && t2Raw !== '' ? Number(t2Raw) : null));

        updateStudentRecord(st.id, domain.id, { t1, t2, memo });
        updatedCount++;
      }
    }

    markDirty(true);
    saveLocalState();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast(`수정본 엑셀에서 ${updatedCount}명의 기록이 역반영되었습니다!`);
  } catch (err) {
    alert("엑셀 역반영 중 오류: " + err.message);
  }
}

// --------------------------------------------------------------------------
// 16. 구글 시트 백엔드 일괄 저장 (SAVE_CLASS_SCORES_BATCH)
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
      showToast(`${appState.activeClass} 전체 학생 성적이 구글 시트에 안전하게 저장되었습니다! 💾`);
      feedbackAction('success');
    } else {
      alert("시트 저장 오류: " + (res.error || '응답 오류'));
    }
  } catch (err) {
    alert("구글 시트 통신 오류: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (text) text.textContent = "저장";
  }
}

// --------------------------------------------------------------------------
// 17. 키패드 독 제어 및 공통 유틸리티
// --------------------------------------------------------------------------
function toggleBottomKeypadDock() {
  const dock = document.getElementById('bottomKeypadDock');
  const text = document.getElementById('dockHandleText');
  const scrollWrap = document.querySelector('.measurement-scroll-content');
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

// 환경설정 테마/배경/폰트 UI
function initSettingsModal() {
  document.getElementById('btnOpenSettings')?.addEventListener('click', () => {
    syncSettingsUI();
    openModal('settingsModal');
  });

  document.getElementById('btnTestApiConnection')?.addEventListener('click', async () => {
    const url = document.getElementById('gasApiUrlInput')?.value.trim();
    if (!url) {
      alert("GAS 엔드포인트 URL을 입력하세요.");
      return;
    }
    const btn = document.getElementById('btnTestApiConnection');
    btn.textContent = "테스트 중...";
    try {
      const res = await fetch(`${url}?action=PING&_t=${Date.now()}`);
      const json = await res.json();
      if (json && json.status === 'PONG') {
        alert("구글 앱스 스크립트(GAS) Web App API와 정상 연결되었습니다! 🚀");
      } else {
        alert("연결 응답 형식이 올바르지 않습니다.");
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
    renderDomainEditorList();
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

  initBackupRestoreEngine();
}

function syncSettingsUI() {
  const urlInput = document.getElementById('gasApiUrlInput');
  const fontSel = document.getElementById('fontFamilySelector');
  const titleInput = document.getElementById('appMainTitleInput');
  if (titleInput) titleInput.value = appState.settings.appTitle || '수행평가 입력기 Pro';
  if (urlInput) urlInput.value = appState.settings.gasApiUrl || defaultSettings.gasApiUrl;
  if (fontSel) fontSel.value = appState.settings.font || 'pretendard';
  renderDomainEditorList();
}

function renderThemeColorsPicker() {
  const container = document.getElementById('themeColorGrid');
  if (!container) return;
  const themes = [
    { key: 'indigo', color: '#4f46e5' },
    { key: 'emerald', color: '#059669' },
    { key: 'sky', color: '#0284c7' },
    { key: 'teal', color: '#0d9488' },
    { key: 'violet', color: '#7c3aed' },
    { key: 'fuchsia', color: '#c026d3' },
    { key: 'rose', color: '#e11d48' },
    { key: 'amber', color: '#d97706' },
    { key: 'orange', color: '#ea580c' },
    { key: 'lime', color: '#65a30d' },
    { key: 'slate', color: '#334155' },
    { key: 'zinc', color: '#52525b' }
  ];

  container.innerHTML = themes.map(t => `
    <button class="theme-color-btn ${appState.settings.theme === t.key ? 'active' : ''}" data-theme="${t.key}" style="background-color: ${t.color};" onclick="setAppTheme('${t.key}')" title="${t.key}"></button>
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

// --------------------------------------------------------------------------
// 18. 앱 부트스트랩 및 이벤트 리스너 바인딩
// --------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initLocalStorageData();

  updateSemesterHeaderDisplay();
  renderClassTabs();
  renderDomainTabs();
  updateUndoRedoButtons();
  selectFirstStudentInClass();

  // 모달 닫기
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const target = document.getElementById(targetId);
      if (target) target.classList.add('hidden');
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

  // 마감 잠금 토글
  document.getElementById('btnToggleDomainLock')?.addEventListener('click', toggleDomainLock);

  // 헤더 주요 모달 버튼
  document.getElementById('btnOpenDashboard')?.addEventListener('click', openDashboard);
  document.getElementById('btnOpenVbaModal')?.addEventListener('click', () => openModal('vbaGuideModal'));
  document.getElementById('btnCopyVbaCode')?.addEventListener('click', () => {
    const code = document.getElementById('vbaCodeArea')?.value;
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        showToast("VBA 매크로 코드가 클립보드에 복사되었습니다! 📋");
      });
    }
  });

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

  // 신규 반 추가
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

  // 1차/2차 시기 세그먼트
  document.querySelectorAll('#trialSegment .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.activeTrial = Number(btn.getAttribute('data-trial'));
      feedbackAction('tap');
      updateActiveStudentPanel();
    });
  });

  // 키패드 엔진 바인딩
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

  // 우측 격리 키패드 독 접기/펼치기
  document.getElementById('btnToggleKeypadDock')?.addEventListener('click', toggleBottomKeypadDock);

  // 개별 모듈 이벤트 등록
  document.getElementById('btnOpenPhotoStudio')?.addEventListener('click', openPhotoStudio);
  initCanvasStudioEvents();
  initIntegratedRosterUploader();
  initClassResetModal();
  initMemoModal();
  initStudentManager();
  initDataCenter();
  initSettingsModal();

  if (window.lucide) lucide.createIcons();
});
