/* ==========================================================================
   수행평가 입력기 Pro (v2.0) - 핵심 통합 제어 스크립트 (app.js)
   측정 엔진, 키패드, 캔버스 스튜디오, JSZip 엑셀 파서, Undo/Redo, GAS API 연동
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. 전역 상태 관리 (State Management)
// --------------------------------------------------------------------------
const APP_STORAGE_KEY = 'PE_EVAL_PRO_V2_DATA';
const SETTINGS_STORAGE_KEY = 'PE_EVAL_PRO_V2_SETTINGS';

const defaultSettings = {
  gasApiUrl: 'https://script.google.com/macros/s/AKfycbxP_C6mySgyfnH8ePxVqZ2f67VHdo6eK0TNYcmWdO7xMPjfxTRtnW7_ct_g7MaXA0-aHw/exec',
  theme: 'indigo',
  bg: 'slate',
  font: 'pretendard',
  classes: ['1반', '2반', '3반', '4반', '5반'],
  domains: [
    {
      key: 'table_tennis',
      name: '탁구 포핸드',
      maxScore: 20,
      absentScore: 0,
      criteria: [
        { count: 10, score: 20 },
        { count: 8, score: 18 },
        { count: 6, score: 16 },
        { count: 4, score: 14 },
        { count: 2, score: 12 },
        { count: 0, score: 10 }
      ]
    },
    {
      key: 'big_volleyball',
      name: '빅발리볼 서브',
      maxScore: 20,
      absentScore: 0,
      criteria: [
        { count: 5, score: 20 },
        { count: 4, score: 18 },
        { count: 3, score: 16 },
        { count: 2, score: 14 },
        { count: 1, score: 12 },
        { count: 0, score: 10 }
      ]
    }
  ],
  lockedDomains: {} // 예: { '2026-2_1반_table_tennis': true }
};

let appState = {
  currentSemester: '2026학년도 2학기',
  semesters: ['2026학년도 1학기', '2026학년도 2학기'],
  activeClass: '1반',
  activeDomainKey: 'table_tennis',
  activeTrial: 1,
  selectedStudentId: null,
  activeFilter: 'all',
  searchQuery: '',
  isDirty: false,
  settings: { ...defaultSettings },
  // 학기별 데이터 분리 저장: { [학기명]: { students: [...], records: { [학번_종목]: { t1, t2, score, memo } } } }
  database: {}
};

// Undo / Redo 히스토리 스택
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 30;

// 오디오 컨텍스트 (비프음 피드백)
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
// 2. 사운드 & 햅틱 피드백 엔진
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

function playBeep(freq = 520, duration = 0.05, type = 'sine') {
  try {
    initAudio();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

function triggerHaptic(ms = 15) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (e) {}
  }
}

function feedbackAction(type = 'tap') {
  triggerHaptic(type === 'error' ? [30, 40, 30] : 12);
  if (type === 'tap') playBeep(580, 0.04);
  else if (type === 'success') playBeep(780, 0.08);
  else if (type === 'pass') playBeep(440, 0.06);
  else if (type === 'clear') playBeep(320, 0.06);
  else if (type === 'error') playBeep(240, 0.12, 'sawtooth');
}

// --------------------------------------------------------------------------
// 3. 로컬 스토리지 및 기본 데이터 초기화
// --------------------------------------------------------------------------
function initLocalStorageData() {
  const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (savedSettings) {
    try {
      appState.settings = JSON.parse(savedSettings);
    } catch (e) {
      appState.settings = { ...defaultSettings };
    }
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
}

function ensureSemesterData(semester) {
  if (!appState.database[semester]) {
    appState.database[semester] = {
      students: [],
      records: {}
    };
  }
  // 기본 학생 데이터가 없으면 예시 데이터 생성
  if (appState.database[semester].students.length === 0) {
    const list = [];
    appState.settings.classes.forEach(cName => {
      for (let i = 1; i <= 20; i++) {
        list.push({
          id: `${cName}-${String(i).padStart(2, '0')}`,
          classNum: cName,
          num: i,
          name: `학생${i}`,
          photoUrl: '',
          memo: ''
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
// 5. 평가 연산 및 배점 매핑 엔진
// --------------------------------------------------------------------------
function getCurrentDomain() {
  return appState.settings.domains.find(d => d.key === appState.activeDomainKey) || appState.settings.domains[0];
}

function calculateScoreFromCount(count, domain) {
  if (count === -1) return domain.absentScore !== undefined ? domain.absentScore : 0;
  if (count === null || count === undefined || count === '' || count === '-') return null;

  const numericCount = Number(count);
  if (isNaN(numericCount)) return null;

  // 배점 기준 정렬 (성공 횟수 내림차순)
  const sortedCriteria = [...domain.criteria].sort((a, b) => b.count - a.count);
  for (const c of sortedCriteria) {
    if (numericCount >= c.count) return c.score;
  }
  return domain.absentScore !== undefined ? domain.absentScore : 0;
}

function getStudentRecord(studentId, domainKey) {
  const currentSem = appState.currentSemester;
  const key = `${studentId}_${domainKey}`;
  const rec = (appState.database[currentSem] && appState.database[currentSem].records)
    ? appState.database[currentSem].records[key]
    : null;
  return rec || { t1: null, t2: null, finalScore: null, memo: '' };
}

function updateStudentRecord(studentId, domainKey, newValues) {
  pushHistorySnapshot();
  const currentSem = appState.currentSemester;
  if (!appState.database[currentSem].records) appState.database[currentSem].records = {};

  const key = `${studentId}_${domainKey}`;
  const existing = appState.database[currentSem].records[key] || { t1: null, t2: null, finalScore: null, memo: '' };
  const updated = { ...existing, ...newValues };

  // 최종 환산 점수 재계산
  const domain = getCurrentDomain();
  const s1 = calculateScoreFromCount(updated.t1, domain);
  const s2 = calculateScoreFromCount(updated.t2, domain);

  if (updated.t1 === -1 && (updated.t2 === -1 || updated.t2 === null)) {
    updated.finalScore = domain.absentScore || 0;
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

function isDomainLocked(classNum, domainKey) {
  const lockKey = `${appState.currentSemester}_${classNum}_${domainKey}`;
  return !!appState.settings.lockedDomains[lockKey];
}

function toggleDomainLock() {
  const lockKey = `${appState.currentSemester}_${appState.activeClass}_${appState.activeDomainKey}`;
  const currentStatus = !!appState.settings.lockedDomains[lockKey];
  appState.settings.lockedDomains[lockKey] = !currentStatus;
  saveLocalState();
  updateLockUI();
  feedbackAction('tap');
  showToast(appState.settings.lockedDomains[lockKey] ? "평가 입력이 마감(잠금)되었습니다." : "평가 입력이 활성화되었습니다.");
}

function updateLockUI() {
  const locked = isDomainLocked(appState.activeClass, appState.activeDomainKey);
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
// 6. UI 내비게이션 & 학생 명렬표 렌더링
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
    btn.className = `domain-tab-btn ${d.key === appState.activeDomainKey ? 'active' : ''}`;
    btn.textContent = d.name;
    btn.onclick = () => {
      appState.activeDomainKey = d.key;
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

  const sorted = [...domain.criteria].sort((a, b) => b.count - a.count);
  sorted.forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'criteria-mini-chip';
    chip.textContent = `${c.count}회 : ${c.score}점`;
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
    const rec = getStudentRecord(st.id, appState.activeDomainKey);
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

  // 필터 카운트 갱신
  let doneCnt = 0, absentCnt = 0, undoneCnt = 0;
  allClassStudents.forEach(st => {
    const r = getStudentRecord(st.id, appState.activeDomainKey);
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
    const rec = getStudentRecord(student.id, appState.activeDomainKey);
    const isSelected = student.id === appState.selectedStudentId;

    const card = document.createElement('div');
    card.className = `student-card ${isSelected ? 'active-card' : ''}`;
    card.id = `studentCard_${student.id}`;

    // 상태 배지 판별
    let badgeHtml = '';
    if (rec.t1 === -1) {
      badgeHtml = `<span class="card-badge absent">결석</span>`;
    } else if (rec.finalScore !== null) {
      badgeHtml = `<span class="card-badge done">${rec.finalScore}점</span>`;
    } else {
      badgeHtml = `<span class="card-badge undone">미측정</span>`;
    }

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
          <span>1차: ${rec.t1 !== null ? rec.t1 : '-'}</span>
          <span>·</span>
          <span>2차: ${rec.t2 !== null ? rec.t2 : '-'}</span>
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
// 7. 활성 학생 측정 패널 업데이트 & 키패드 인터랙션
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
    return;
  }

  const rec = getStudentRecord(student.id, appState.activeDomainKey);

  if (nameEl) nameEl.textContent = student.name;
  if (classEl) classEl.textContent = student.classNum;
  if (numEl) numEl.textContent = `${student.num}번`;
  if (avatarEl) {
    avatarEl.src = student.photoUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'%3E%3C/path%3E%3Ccircle cx='12' cy='7' r='4'%3E%3C/circle%3E%3C/svg%3E";
  }

  // 상태 배지
  if (statusBadge) {
    if (rec.t1 === -1) {
      statusBadge.className = 'status-badge card-badge absent';
      statusBadge.textContent = '결석';
    } else if (rec.finalScore !== null) {
      statusBadge.className = 'status-badge card-badge done';
      statusBadge.textContent = `${rec.finalScore}점 완료`;
    } else {
      statusBadge.className = 'status-badge card-badge undone';
      statusBadge.textContent = '대기';
    }
  }

  // 상단 스코어 스트립
  if (dispT1) dispT1.textContent = rec.t1 !== null ? (rec.t1 === -1 ? '결석' : `${rec.t1}회`) : '-';
  if (dispT2) dispT2.textContent = rec.t2 !== null ? (rec.t2 === -1 ? '결석' : (rec.t2 === 'pass' ? '패스(-)' : `${rec.t2}회`)) : '-';
  if (dispFinal) dispFinal.textContent = rec.finalScore !== null ? `${rec.finalScore} 점` : '-';

  // 현재 측정 시기 디스플레이
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

  // 메모 알림 배지
  if (memoDot) {
    if (rec.memo) memoDot.classList.remove('hidden');
    else memoDot.classList.add('hidden');
  }

  updateTrialSegmentUI();
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

// 온스크린 키패드 입력 핸들러
function handleKeypadInput(value) {
  const student = getSelectedStudent();
  if (!student) return;
  if (isDomainLocked(appState.activeClass, appState.activeDomainKey)) {
    feedbackAction('error');
    showToast("입력이 마감되어 기록을 변경할 수 없습니다.");
    return;
  }

  const domain = getCurrentDomain();
  const autoPass = document.getElementById('chkAutoPass')?.checked ?? true;
  const trial = appState.activeTrial;

  if (value === 'pass') {
    // 2차 시기 수동 패스 처리
    if (trial === 1) {
      showToast("패스는 2차 시기에 적용됩니다.");
      appState.activeTrial = 2;
    }
    updateStudentRecord(student.id, appState.activeDomainKey, { t2: 'pass' });
    feedbackAction('pass');
    moveToNextStudent(1);
    return;
  }

  if (value === 'absent') {
    // 결석 처리 (-1)
    updateStudentRecord(student.id, appState.activeDomainKey, { t1: -1, t2: -1 });
    feedbackAction('clear');
    moveToNextStudent(1);
    return;
  }

  if (value === 'clear') {
    // 기록 초기화
    if (trial === 1) {
      updateStudentRecord(student.id, appState.activeDomainKey, { t1: null, t2: null });
    } else {
      updateStudentRecord(student.id, appState.activeDomainKey, { t2: null });
    }
    feedbackAction('clear');
    renderStudentList();
    updateActiveStudentPanel();
    return;
  }

  // 일반 숫자 입력 (0 ~ 10)
  const count = Number(value);
  const score = calculateScoreFromCount(count, domain);

  if (trial === 1) {
    // 1차 시기 만점 달성 시 2차 자동 패스 및 다음 학생 이동
    if (autoPass && score >= domain.maxScore) {
      updateStudentRecord(student.id, appState.activeDomainKey, { t1: count, t2: 'pass' });
      feedbackAction('success');
      showToast(`${student.name} 1차 만점! 2차 자동 패스되었습니다.`);
      moveToNextStudent(1);
      return;
    } else {
      updateStudentRecord(student.id, appState.activeDomainKey, { t1: count });
      feedbackAction('tap');
      // 만점이 아니면 2차 시기로 즉시 전환
      appState.activeTrial = 2;
      renderStudentList();
      updateActiveStudentPanel();
      return;
    }
  } else {
    // 2차 시기 기록 입력 후 다음 학생 1차 시기로 이동
    updateStudentRecord(student.id, appState.activeDomainKey, { t2: count });
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
  appState.activeTrial = 1; // 새 학생은 항상 1차 시기부터 시작
  renderStudentList();
  updateActiveStudentPanel();

  // 자동 스크롤
  const card = document.getElementById(`studentCard_${appState.selectedStudentId}`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --------------------------------------------------------------------------
// 8. 캔버스 사진 스튜디오 & 필터 엔진
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

  // 중앙 기준 변형 적용
  ctx.translate(canvas.width / 2 + studioState.panX, canvas.height / 2 + studioState.panY);
  ctx.rotate((studioState.rotation * Math.PI) / 180);
  ctx.scale((studioState.zoom / 100) * (studioState.scaleX / 100), (studioState.zoom / 100) * (studioState.scaleY / 100));

  const imgW = studioImage.width || 400;
  const imgH = studioImage.height || 400;
  const aspect = imgW / imgH;
  let drawW = 320;
  let drawH = 320 / aspect;
  if (drawH < 320) {
    drawH = 320;
    drawW = 320 * aspect;
  }

  ctx.drawImage(studioImage, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // 8종 필터 픽셀 연산 적용
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

  // 슬라이더 바인딩
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

  // 회전 및 리셋
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

  // 필터 버튼 클릭
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      studioState.filter = btn.getAttribute('data-filter');
      renderStudioCanvas();
    });
  });

  // 파일 업로드 (카메라/앨범)
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

  // 적용 및 저장
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

    // GAS 백엔드 연동 시 비동기 클라우드 드라이브 백업
    if (appState.settings.gasApiUrl) {
      callGasApi('UPLOAD_STUDENT_AVATAR', {
        studentId: student.id,
        name: student.name,
        classNum: student.classNum,
        base64Data: base64
      }).then(res => {
        if (res && res.fileUrl) {
          student.photoUrl = res.fileUrl;
          saveLocalState();
        }
      }).catch(() => {});
    }
  });

  // 사진 삭제
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
    }
  });
}

// --------------------------------------------------------------------------
// 9. JSZip 기반 사진 명렬표 엑셀 일괄 등록 & VBA 가이드
// --------------------------------------------------------------------------
function initBulkPhotoUploader() {
  const dropZone = document.getElementById('bulkDropZone');
  const fileInput = document.getElementById('bulkExcelFileInput');

  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
  dropZone?.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--primary-border)'; });
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--primary-border)';
    if (e.dataTransfer.files.length > 0) processBulkExcelFile(e.dataTransfer.files[0]);
  });
  fileInput?.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processBulkExcelFile(e.target.files[0]);
  });

  // VBA 매크로 복사 모달
  document.getElementById('btnOpenVbaModal')?.addEventListener('click', () => {
    openModal('vbaGuideModal');
  });
  document.getElementById('btnCopyVbaCode')?.addEventListener('click', () => {
    const code = document.getElementById('vbaCodeArea')?.value;
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        showToast("VBA 매크로 코드가 클립보드에 복사되었습니다! 📋");
      });
    }
  });
}

async function processBulkExcelFile(file) {
  if (!file || !file.name.endsWith('.xlsx')) {
    alert("올바른 엑셀(.xlsx) 파일을 선택해주세요.");
    return;
  }

  const pWrap = document.getElementById('bulkProgressWrap');
  const pBar = document.getElementById('bulkProgressBar');
  const pText = document.getElementById('bulkProgressText');
  if (pWrap) pWrap.classList.remove('hidden');

  try {
    pText.textContent = "엑셀 파일 읽는 중...";
    pBar.style.width = "20%";

    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 엑셀 내 이미지 추출 (/xl/media/)
    const mediaFiles = Object.keys(zip.files).filter(fileName => fileName.startsWith('xl/media/'));
    if (mediaFiles.length === 0) {
      alert("엑셀 파일 내에 포함된 학생 사진을 찾을 수 없습니다.");
      if (pWrap) pWrap.classList.add('hidden');
      return;
    }

    pText.textContent = `사진 ${mediaFiles.length}장 추출 및 번호 매칭 중...`;
    pBar.style.width = "50%";

    // 파일명 기준 정렬 (image1, image2, ...)
    mediaFiles.sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
      return numA - numB;
    });

    const sem = appState.currentSemester;
    const classStudents = (appState.database[sem]?.students || [])
      .filter(s => s.classNum === appState.activeClass)
      .sort((a, b) => a.num - b.num);

    let matchCount = 0;
    for (let i = 0; i < Math.min(mediaFiles.length, classStudents.length); i++) {
      const fName = mediaFiles[i];
      const imgBlob = await zip.files[fName].async('blob');
      const base64Data = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(imgBlob);
      });

      classStudents[i].photoUrl = base64Data;
      matchCount++;
      pBar.style.width = `${50 + Math.round((i / classStudents.length) * 45)}%`;
    }

    markDirty(true);
    saveLocalState();
    renderStudentList();
    updateActiveStudentPanel();

    pBar.style.width = "100%";
    pText.textContent = `매칭 완료! (${matchCount}명 사진 등록됨)`;
    setTimeout(() => {
      closeAllModals();
      showToast(`${appState.activeClass} 학생 ${matchCount}명의 사진이 성공적으로 일괄 등록되었습니다! 📸`);
    }, 600);

  } catch (err) {
    alert("엑셀 사진 추출 중 오류가 발생했습니다: " + err.message);
    if (pWrap) pWrap.classList.add('hidden');
  }
}

// --------------------------------------------------------------------------
// 10. 학생 관찰 메모 모달
// --------------------------------------------------------------------------
function initMemoModal() {
  const btnOpen = document.getElementById('btnOpenMemoModal');
  const btnSave = document.getElementById('btnSaveMemo');
  const btnDelete = document.getElementById('btnDeleteMemo');

  btnOpen?.addEventListener('click', () => {
    const student = getSelectedStudent();
    if (!student) return;
    const rec = getStudentRecord(student.id, appState.activeDomainKey);

    const titleEl = document.getElementById('memoStudentTitle');
    const inputEl = document.getElementById('studentMemoInput');
    if (titleEl) titleEl.textContent = `${student.classNum} ${student.num}번 ${student.name} (${getCurrentDomain().name})`;
    if (inputEl) inputEl.value = rec.memo || '';

    openModal('memoModal');
  });

  // 빠른 태그 클릭 시 인풋에 태그 추가
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

  btnSave?.addEventListener('click', () => {
    const student = getSelectedStudent();
    if (!student) return;
    const memoText = document.getElementById('studentMemoInput')?.value.trim() || '';
    updateStudentRecord(student.id, appState.activeDomainKey, { memo: memoText });
    closeAllModals();
    renderStudentList();
    updateActiveStudentPanel();
    showToast("관찰 메모가 저장되었습니다.");
  });

  btnDelete?.addEventListener('click', () => {
    const student = getSelectedStudent();
    if (!student) return;
    updateStudentRecord(student.id, appState.activeDomainKey, { memo: '' });
    closeAllModals();
    renderStudentList();
    updateActiveStudentPanel();
    showToast("관찰 메모가 삭제되었습니다.");
  });
}

// --------------------------------------------------------------------------
// 11. 명단 관리 (전입, 전출, 번호 일괄 재부여)
// --------------------------------------------------------------------------
function openStudentManager() {
  renderManageStudentTable();
  openModal('studentManagerModal');
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
        <input type="number" class="table-num-input" value="${st.num}" data-id="${st.id}" style="width:46px;text-align:center;border:1px solid var(--border-color);border-radius:4px;">
      </td>
      <td>
        <input type="text" class="table-name-input" value="${st.name}" data-id="${st.id}" style="width:100%;border:1px solid var(--border-color);border-radius:4px;padding:2px 6px;">
      </td>
      <td style="text-align:center;">
        <button class="btn-step-order" onclick="moveStudentRowOrder('${st.id}', -1)" title="위로">▲</button>
        <button class="btn-step-order" onclick="moveStudentRowOrder('${st.id}', 1)" title="아래로">▼</button>
      </td>
      <td style="text-align:center;">
        <button class="btn-delete-student" onclick="deleteStudentRecord('${st.id}')" style="color:var(--danger);font-weight:bold;">삭제</button>
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

  // 순서대로 번호 자동 동기화
  currentClassStudents.forEach((s, i) => s.num = i + 1);

  renderManageStudentTable();
};

window.deleteStudentRecord = function(studentId) {
  if (!confirm("해당 학생을 명단에서 전출(삭제) 처리하시겠습니까?")) return;
  const sem = appState.currentSemester;
  appState.database[sem].students = appState.database[sem].students.filter(s => s.id !== studentId);
  markDirty(true);
  saveLocalState();
  renderManageStudentTable();
  renderStudentList();
};

function initStudentManager() {
  document.getElementById('btnOpenStudentManager')?.addEventListener('click', openStudentManager);

  // 전입 학생 추가
  document.getElementById('btnAddStudentSubmit')?.addEventListener('click', () => {
    const classVal = document.getElementById('addStudentClass')?.value.trim() || appState.activeClass;
    const numVal = parseInt(document.getElementById('addStudentNumber')?.value);
    const nameVal = document.getElementById('addStudentName')?.value.trim();

    if (!numVal || !nameVal) {
      alert("번호와 성명을 올바르게 입력해주세요.");
      return;
    }

    const sem = appState.currentSemester;
    const newId = `${classVal}-${String(numVal).padStart(2, '0')}_${Date.now()}`;
    appState.database[sem].students.push({
      id: newId,
      classNum: classVal,
      num: numVal,
      name: nameVal,
      photoUrl: '',
      memo: ''
    });

    markDirty(true);
    saveLocalState();
    renderManageStudentTable();
    renderStudentList();
    showToast(`전입 학생 [${nameVal}] 등록 완료`);

    document.getElementById('addStudentName').value = '';
    document.getElementById('addStudentNumber').value = numVal + 1;
  });

  // 번호 일괄 재부여
  document.getElementById('btnRenumberAll')?.addEventListener('click', () => {
    if (!confirm("현재 정렬 순서대로 1번부터 번호를 순차적으로 재부여하시겠습니까?")) return;
    const sem = appState.currentSemester;
    const classStudents = appState.database[sem].students.filter(s => s.classNum === appState.activeClass);
    classStudents.forEach((s, idx) => s.num = idx + 1);
    markDirty(true);
    saveLocalState();
    renderManageStudentTable();
    renderStudentList();
    showToast("번호 일괄 재부여가 완료되었습니다.");
  });

  // 변경사항 시트 반영 (저장)
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
    showToast("학생 명단 변경사항이 성공적으로 반영되었습니다.");
  });
}

// --------------------------------------------------------------------------
// 12. 통계 & 현황 대시보드
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
    const r = getStudentRecord(s.id, curDomain.key);
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

  // 학급별 프로그레스 카드 렌더링
  const cardsContainer = document.getElementById('classProgressCardsContainer');
  if (cardsContainer) {
    cardsContainer.innerHTML = '';
    appState.settings.classes.forEach(cName => {
      const cStudents = students.filter(s => s.classNum === cName);
      let cDone = 0;
      let cUndone = [];
      let cAbsent = [];

      cStudents.forEach(st => {
        const r = getStudentRecord(st.id, curDomain.key);
        if (r.t1 === -1) cAbsent.push(st.name);
        else if (r.finalScore !== null) cDone++;
        else cUndone.push(st.name);
      });

      const cRate = cStudents.length > 0 ? Math.round((cDone / cStudents.length) * 100) : 0;

      const card = document.createElement('div');
      card.className = 'class-progress-card';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:0.9rem;">${cName}</strong>
          <span style="font-size:0.8rem;font-weight:bold;color:var(--primary);">${cDone} / ${cStudents.length}명 (${cRate}%)</span>
        </div>
        <div class="progress-bar-bg" style="margin-top:4px;">
          <div class="progress-bar-fill" style="width:${cRate}%;"></div>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">
          미측정: <span style="color:var(--warning);font-weight:bold;">${cUndone.length > 0 ? cUndone.join(', ') : '없음'}</span>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);">
          결석: <span style="color:var(--danger);font-weight:bold;">${cAbsent.length > 0 ? cAbsent.join(', ') : '없음'}</span>
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
// 13. 데이터 센터 & 엑셀 내보내기/가져오기 & 학기 관리
// --------------------------------------------------------------------------
function initDataCenter() {
  document.getElementById('btnOpenDataCenter')?.addEventListener('click', () => {
    updateSemesterDropdown();
    openModal('dataCenterModal');
  });

  // 학기 전환
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

  // 새 학기 생성
  document.getElementById('btnOpenNewSemesterDialog')?.addEventListener('click', () => {
    const newName = prompt("신규 생성할 학기 명칭을 입력하세요 (예: 2027학년도 1학기):");
    if (!newName || !newName.trim()) return;
    if (appState.semesters.includes(newName.trim())) {
      alert("이미 존재하는 학기명입니다.");
      return;
    }

    const copyPrev = confirm("기존 학기의 학생 명렬표를 그대로 복사해서 가져오시겠습니까?\n(점수와 기록은 초기화된 상태로 시작됩니다)");
    const prevSem = appState.currentSemester;
    const newSem = newName.trim();

    appState.semesters.push(newSem);
    appState.currentSemester = newSem;

    let studentsCopy = [];
    if (copyPrev && appState.database[prevSem]?.students) {
      studentsCopy = appState.database[prevSem].students.map(s => ({
        ...s,
        memo: ''
      }));
    }

    appState.database[newSem] = {
      students: studentsCopy,
      records: {}
    };

    saveLocalState();
    updateSemesterHeaderDisplay();
    updateSemesterDropdown();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast(`신규 [${newSem}] 학기가 개설되었습니다! 🎉`);
  });

  // 학기명 수정
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

  // 학기 삭제
  document.getElementById('btnDeleteCurrentSemester')?.addEventListener('click', () => {
    if (appState.semesters.length <= 1) {
      alert("최소 1개 이상의 학기가 유지되어야 합니다.");
      return;
    }
    const current = appState.currentSemester;
    if (!confirm(`정말로 [${current}] 학기의 모든 명렬표와 측정 데이터를 영구 삭제하시겠습니까?`)) return;

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

  // 세부기록 엑셀 다운로드
  document.getElementById('btnExportDetailExcel')?.addEventListener('click', () => exportDetailedExcel());

  // NEIS 일괄등록 엑셀 다운로드
  document.getElementById('btnExportNeisExcel')?.addEventListener('click', () => exportNeisExcel());

  // 세부기록 수정본 역반영 업로드
  document.getElementById('reverseExcelFileInput')?.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleReverseExcelUpload(e.target.files[0]);
  });

  // 반 기록 초기화
  document.getElementById('btnResetCurrentDomain')?.addEventListener('click', () => {
    const cDomain = getCurrentDomain();
    if (!confirm(`[${appState.activeClass}]의 [${cDomain.name}] 기록만 모두 비우시겠습니까?`)) return;
    pushHistorySnapshot();
    const sem = appState.currentSemester;
    const students = appState.database[sem]?.students || [];
    students.filter(s => s.classNum === appState.activeClass).forEach(st => {
      const key = `${st.id}_${cDomain.key}`;
      if (appState.database[sem].records[key]) {
        delete appState.database[sem].records[key];
      }
    });
    markDirty(true);
    saveLocalState();
    renderStudentList();
    updateActiveStudentPanel();
    closeAllModals();
    showToast("현재 반·종목 기록이 초기화되었습니다.");
  });

  document.getElementById('btnResetAllDomains')?.addEventListener('click', () => {
    if (!confirm(`경고: [${appState.activeClass}]의 모든 평가 종목 기록을 완전히 초기화하시겠습니까?`)) return;
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
    showToast("현재 반의 모든 평가영역 기록이 초기화되었습니다.");
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

// 세부기록 엑셀 내보내기 (SheetJS)
function exportDetailedExcel() {
  const sem = appState.currentSemester;
  const students = appState.database[sem]?.students || [];
  const domain = getCurrentDomain();

  const dataRows = [
    ['학기', '학급', '번호', '성명', '평가영역', '1차 시기', '2차 시기', '최종 환산점수', '관찰 메모']
  ];

  students.forEach(st => {
    const r = getStudentRecord(st.id, domain.key);
    dataRows.push([
      sem,
      st.classNum,
      st.num,
      st.name,
      domain.name,
      r.t1 !== null ? (r.t1 === -1 ? '결석' : r.t1) : '',
      r.t2 !== null ? (r.t2 === -1 ? '결석' : (r.t2 === 'pass' ? '패스' : r.t2)) : '',
      r.finalScore !== null ? r.finalScore : '',
      r.memo || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(dataRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "세부측정기록");
  XLSX.writeFile(wb, `[수행평가세부기록]_${sem}_${domain.name}_${Date.now()}.xlsx`);
  showToast("세부기록 엑셀이 다운로드되었습니다. 📊");
}

// 나이스(NEIS) 규격 일괄등록 엑셀 내보내기
function exportNeisExcel() {
  const sem = appState.currentSemester;
  const students = appState.database[sem]?.students || [];
  const domain = getCurrentDomain();

  const dataRows = [
    ['반', '번호', '성명', '점수']
  ];

  students.forEach(st => {
    const r = getStudentRecord(st.id, domain.key);
    dataRows.push([
      st.classNum.replace(/[^0-9]/g, ''),
      st.num,
      st.name,
      r.finalScore !== null ? r.finalScore : ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(dataRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "NEIS업로드양식");
  XLSX.writeFile(wb, `[NEIS일괄등록]_${sem}_${domain.name}.xlsx`);
  showToast("NEIS 일괄등록 엑셀 서식이 다운로드되었습니다. 📑");
}

// 수정된 엑셀 역반영 업로드
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

    // 헤더 제외 행 분석
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 4) continue;
      const cNum = String(r[1]).includes('반') ? String(r[1]) : `${r[1]}반`;
      const num = parseInt(r[2]);
      const name = String(r[3]).trim();
      const t1Raw = r[5];
      const t2Raw = r[6];
      const memo = r[8] || '';

      const st = (appState.database[sem]?.students || []).find(s => s.classNum === cNum && s.num === num);
      if (st) {
        let t1 = (t1Raw === '결석' || t1Raw === -1) ? -1 : (t1Raw !== undefined && t1Raw !== '' ? Number(t1Raw) : null);
        let t2 = (t2Raw === '결석' || t2Raw === -1) ? -1 : ((t2Raw === '패스' || t2Raw === '-') ? 'pass' : (t2Raw !== undefined && t2Raw !== '' ? Number(t2Raw) : null));

        updateStudentRecord(st.id, domain.key, { t1, t2, memo });
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
    alert("엑셀 파싱 중 오류가 발생했습니다: " + err.message);
  }
}

// --------------------------------------------------------------------------
// 14. 커스텀 설정, 테마/폰트 & 전체 JSON 백업/복원
// --------------------------------------------------------------------------
function initSettingsModal() {
  document.getElementById('btnOpenSettings')?.addEventListener('click', () => {
    syncSettingsUI();
    openModal('settingsModal');
  });

  // GAS API URL 입력 및 연결 테스트
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
        alert("구글 앱스 스크립트 API와 성공적으로 연결되었습니다! 🚀");
      } else {
        alert("연결 응답을 확인했으나 형식 오류가 발생했습니다.");
      }
    } catch (e) {
      alert("API 연결 실패: 올바른 Web App URL인지 배포 권한(모든 사용자)을 확인하세요.");
    } finally {
      btn.textContent = "연결 테스트";
    }
  });

  // 테마/배경/폰트 팔레트 동적 렌더링
  renderThemeColorsPicker();
  renderBgStylePicker();

  // 평가 영역 추가
  document.getElementById('btnAddNewDomain')?.addEventListener('click', () => {
    const name = prompt("추가할 신규 평가 영역명을 입력하세요:");
    if (!name || !name.trim()) return;
    const key = `domain_${Date.now()}`;
    appState.settings.domains.push({
      key,
      name: name.trim(),
      maxScore: 20,
      absentScore: 0,
      criteria: [
        { count: 10, score: 20 },
        { count: 8, score: 18 },
        { count: 6, score: 16 },
        { count: 4, score: 14 },
        { count: 2, score: 12 },
        { count: 0, score: 10 }
      ]
    });
    renderDomainEditorList();
  });

  // 설정 저장 및 적용
  document.getElementById('btnSaveAllSettings')?.addEventListener('click', () => {
    appState.settings.gasApiUrl = document.getElementById('gasApiUrlInput')?.value.trim() || '';
    appState.settings.font = document.getElementById('fontFamilySelector')?.value || 'pretendard';

    saveLocalState();
    applyVisualSettings();
    renderDomainTabs();
    closeAllModals();
    showToast("환경설정이 성공적으로 저장 및 적용되었습니다.");
  });

  // 전체 데이터 통합 JSON 내보내기
  document.getElementById('btnExportFullJson')?.addEventListener('click', () => {
    const fullBackup = {
      version: 'pe_pro_v2',
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
    a.download = `[수행평가통합백업]_${appState.currentSemester}_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("전체 데이터 통합 JSON 파일이 다운로드되었습니다. 🛡️");
  });

  // 전체 데이터 통합 JSON 원클릭 복원
  document.getElementById('importJsonFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm("백업 파일을 불러오면 현재 입력된 모든 학기 데이터가 대체됩니다. 계속 진행하시겠습니까?")) {
      e.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // 신형 v2 포맷 또는 기존 v1 포맷 호환 복원
      if (parsed.database) {
        appState.database = parsed.database;
        appState.semesters = parsed.semesters || appState.semesters;
        appState.currentSemester = parsed.currentSemester || appState.semesters[0];
        if (parsed.settings) appState.settings = { ...appState.settings, ...parsed.settings };
      } else if (parsed.sheets || parsed.records) {
        // 기존 단일 시트 백업 포맷 호환 처리
        const sem = appState.currentSemester;
        appState.database[sem] = {
          students: parsed.students || [],
          records: parsed.records || {}
        };
      }

      saveLocalState();
      applyVisualSettings();
      updateSemesterHeaderDisplay();
      renderClassTabs();
      renderDomainTabs();
      selectFirstStudentInClass();
      closeAllModals();
      showToast("전체 데이터가 1초 만에 완벽히 복원되었습니다! 🚀");
    } catch (err) {
      alert("백업 JSON 파일 복원 중 오류가 발생했습니다: " + err.message);
    }
  });
}

function syncSettingsUI() {
  const urlInput = document.getElementById('gasApiUrlInput');
  const fontSel = document.getElementById('fontFamilySelector');
  if (urlInput) urlInput.value = appState.settings.gasApiUrl || '';
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
    { key: 'slate', label: '라이트 슬레이트', color: '#f1f5f9' },
    { key: 'cream', label: '크림 베이지', color: '#f8f6f0' },
    { key: 'mint', label: '산뜻 민트', color: '#eef8f5' },
    { key: 'sky', label: '아이스 블루', color: '#edf6fc' },
    { key: 'lavender', label: '소프트 라벤더', color: '#f5f2fa' },
    { key: 'dark', label: '다크 모드', color: '#151d2e' }
  ];

  container.innerHTML = bgs.map(b => `
    <button class="btn-tool-sub ${appState.settings.bg === b.key ? 'active' : ''}" onclick="setAppBg('${b.key}')" style="display:flex;align-items:center;gap:6px;">
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

function renderDomainEditorList() {
  const container = document.getElementById('domainEditorList');
  if (!container) return;
  container.innerHTML = '';

  appState.settings.domains.forEach((d, idx) => {
    const card = document.createElement('div');
    card.className = 'domain-setting-card';
    card.style.cssText = 'background:var(--bg-surface-sub);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;margin-top:8px;';

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <input type="text" value="${d.name}" class="domain-name-input" data-idx="${idx}" style="font-weight:bold;font-size:0.9rem;border:1px solid var(--border-color);border-radius:4px;padding:3px 8px;">
        <div>
          <span style="font-size:0.75rem;color:var(--text-muted);">만점: </span>
          <input type="number" value="${d.maxScore}" class="domain-max-input" data-idx="${idx}" style="width:50px;border:1px solid var(--border-color);border-radius:4px;padding:2px 4px;text-align:center;">
          <button class="btn-danger-outline" style="padding:2px 8px;font-size:0.7rem;margin-left:6px;" onclick="deleteDomainConfig(${idx})">삭제</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // 인풋 실시간 반영
  container.querySelectorAll('.domain-name-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = e.target.getAttribute('data-idx');
      appState.settings.domains[idx].name = e.target.value.trim() || appState.settings.domains[idx].name;
    });
  });
  container.querySelectorAll('.domain-max-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = e.target.getAttribute('data-idx');
      appState.settings.domains[idx].maxScore = parseInt(e.target.value) || 20;
    });
  });
}

window.deleteDomainConfig = function(idx) {
  if (appState.settings.domains.length <= 1) {
    alert("최소 1개 이상의 평가 영역이 필요합니다.");
    return;
  }
  if (!confirm("이 평가 영역을 삭제하시겠습니까?")) return;
  appState.settings.domains.splice(idx, 1);
  appState.activeDomainKey = appState.settings.domains[0].key;
  renderDomainEditorList();
  renderDomainTabs();
};

// --------------------------------------------------------------------------
// 15. 구글 시트 백엔드 일괄 동기화 (GAS Web App API 연동)
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
    alert("먼저 [설정] 창에서 구글 앱스 스크립트(GAS) Web App API 엔드포인트 URL을 입력해주세요!");
    openModal('settingsModal');
    return;
  }

  const btn = document.getElementById('btnSaveAll');
  const icon = document.getElementById('saveIcon');
  const text = document.getElementById('saveBtnText');

  if (btn) btn.disabled = true;
  if (text) text.textContent = "동기화 중...";
  if (icon) icon.classList.add('animate-spin');

  try {
    const sem = appState.currentSemester;
    const currentStudents = appState.database[sem]?.students || [];
    const currentRecords = appState.database[sem]?.records || {};

    const payload = {
      semester: sem,
      students: currentStudents,
      records: currentRecords,
      settings: appState.settings
    };

    const res = await callGasApi('SYNC_ALL_DATA', payload);

    if (res && res.success) {
      markDirty(false);
      showToast("구글 스프레드시트 중앙 DB와 100% 동기화되었습니다! ☁️");
      feedbackAction('success');
    } else {
      alert("저장 중 오류 응답을 수신했습니다: " + (res.error || '알 수 없는 오류'));
    }
  } catch (err) {
    alert("구글 시트 통신 오류: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (text) text.textContent = "저장";
    if (icon) icon.classList.remove('animate-spin');
  }
}

// --------------------------------------------------------------------------
// 16. 공통 헬퍼: 모달 & 토스트 알림
// --------------------------------------------------------------------------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
}

function showToast(message, duration = 2800) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `<i data-lucide="info" style="width:16px;height:16px;color:var(--primary);"></i> <span>${message}</span>`;
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// --------------------------------------------------------------------------
// 17. 앱 부트스트랩 및 전체 이벤트 바인딩
// --------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initLocalStorageData();

  // 헤더 및 내비게이션 초기화
  updateSemesterHeaderDisplay();
  renderClassTabs();
  renderDomainTabs();
  updateUndoRedoButtons();
  selectFirstStudentInClass();

  // 모달 닫기 버튼 공통 이벤트
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

  // 종목 마감 토글 바인딩
  document.getElementById('btnToggleDomainLock')?.addEventListener('click', toggleDomainLock);

  // 헤더 주요 모달 트리거
  document.getElementById('btnOpenDashboard')?.addEventListener('click', openDashboard);
  document.getElementById('btnSaveAll')?.addEventListener('click', saveAllToGoogleSheets);
  document.getElementById('semesterPill')?.addEventListener('click', () => {
    updateSemesterDropdown();
    openModal('dataCenterModal');
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

  // 시기 선택 세그먼트 (1차/2차)
  document.querySelectorAll('#trialSegment .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.activeTrial = Number(btn.getAttribute('data-trial'));
      feedbackAction('tap');
      updateActiveStudentPanel();
    });
  });

  // 온스크린 키패드 바인딩
  document.querySelectorAll('.count-key').forEach(btn => {
    btn.addEventListener('click', () => handleKeypadInput(btn.getAttribute('data-value')));
  });
  document.getElementById('btnKeyPass')?.addEventListener('click', () => handleKeypadInput('pass'));
  document.getElementById('btnKeyAbsent')?.addEventListener('click', () => handleKeypadInput('absent'));
  document.getElementById('btnKeyClear')?.addEventListener('click', () => handleKeypadInput('clear'));

  // 이전/다음 학생 이동 바인딩
  document.getElementById('btnPrevStudent')?.addEventListener('click', () => {
    feedbackAction('tap');
    moveToNextStudent(-1);
  });
  document.getElementById('btnNextStudent')?.addEventListener('click', () => {
    feedbackAction('tap');
    moveToNextStudent(1);
  });

  // 개별 모듈 초기화
  document.getElementById('btnOpenPhotoStudio')?.addEventListener('click', openPhotoStudio);
  document.getElementById('btnOpenBulkPhoto')?.addEventListener('click', () => openModal('bulkPhotoModal'));
  initCanvasStudioEvents();
  initBulkPhotoUploader();
  initMemoModal();
  initStudentManager();
  initDataCenter();
  initSettingsModal();

  // Lucide 아이콘 초기 렌더링
  if (window.lucide) lucide.createIcons();
});
