const DATA_INDEX_URL = './questions/index.json';
const STORAGE_KEY = 'litiji-practice-v1';
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const EXAM_LIMIT_MS = 60 * 60 * 1000;
const EXAM_PLAN = [['单选', 30], ['判断', 30], ['多选', 20]];
const $ = (id) => document.getElementById(id);
const safeJSON = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
let questions = [];
let state = safeJSON(localStorage.getItem(STORAGE_KEY)) || { answers: {}, favorites: [], studyDays: [] };
let view = '练习';
let pool = [];
let index = 0;
let selected = new Set();
let examIndex = 0;
let examClock = null;
let toastTimer;

if (!state.answers || Array.isArray(state.answers)) state.answers = {};
if (!Array.isArray(state.favorites)) state.favorites = [];
if (!Array.isArray(state.studyDays)) state.studyDays = [];
if (!Array.isArray(state.examHistory)) state.examHistory = [];

const todayKey = () => new Date().toLocaleDateString('en-CA');
const cleanText = (text) => String(text || '').replace(/_x000[bB]_/g, ' ').replace(/[\u0000-\u001f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const isAnsweredToday = (entry) => entry && entry.lastAt && new Date(entry.lastAt).toLocaleDateString('en-CA') === todayKey();
const correctAnswer = (q) => [...String(q.answer || '').toUpperCase()].sort().join('');
const answerLabel = (q) => [...correctAnswer(q)].map((letter) => {
  const i = LETTERS.indexOf(letter);
  return i >= 0 ? `${letter}. ${q.options[i] || ''}` : letter;
}).filter(Boolean).join('；');
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function showToast(message) {
  let node = document.querySelector('.toast');
  if (!node) { node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role', 'status'); document.body.append(node); }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1900);
}

function getWrongIds() {
  return Object.entries(state.answers).filter(([, entry]) => entry.lastCorrect === false).map(([id]) => id);
}
function answerStats() {
  const entries = Object.values(state.answers);
  const attempts = entries.reduce((sum, entry) => sum + (entry.attempts || 0), 0);
  const correct = entries.reduce((sum, entry) => sum + (entry.correctCount || 0), 0);
  return { attempts, correct, accuracy: attempts ? Math.round(correct / attempts * 100) : 0 };
}
function getStreak() {
  const days = new Set(state.studyDays);
  const date = new Date();
  let streak = 0;
  while (true) {
    const key = date.toLocaleDateString('en-CA');
    if (!days.has(key)) break;
    streak++;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}
function updateOverview() {
  const stats = answerStats();
  $('total-count').textContent = questions.length.toLocaleString('zh-CN');
  $('answered-count').textContent = stats.attempts.toLocaleString('zh-CN');
  $('accuracy-count').innerHTML = `${stats.accuracy}<span class="stat-unit">%</span>`;
  $('wrong-count').textContent = getWrongIds().length;
  $('favorite-count').textContent = state.favorites.length;
  $('streak-number').textContent = getStreak();
  const days = [...state.studyDays];
  const dots = $('week-dots');
  dots.replaceChildren();
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  '一二三四五六日'.split('').forEach((label, i) => {
    const date = new Date(monday); date.setDate(monday.getDate() + i);
    const span = document.createElement('span'); span.textContent = label;
    if (days.includes(date.toLocaleDateString('en-CA'))) span.classList.add('done');
    dots.append(span);
  });
  const todayCount = Object.values(state.answers).filter(isAnsweredToday).length;
  const progress = Math.min(100, Math.round(todayCount / 20 * 100));
  $('daily-progress').textContent = `${progress}%`;
  $('daily-caption').textContent = todayCount ? ` · 已完成 ${todayCount} 题` : ' · 还没开始';
  $('stamp-ring').style.background = `conic-gradient(var(--green-2) ${progress * 3.6}deg,#e2e9df ${progress * 3.6}deg)`;

  const counts = Object.fromEntries(['单选','多选','判断'].map(type => [type, questions.filter(q => q.type === type).length]));
  const max = Math.max(1, ...Object.values(counts));
  [['单选','single'],['多选','multiple'],['判断','judge']].forEach(([type, prefix]) => {
    $(`${prefix}-num`).textContent = counts[type].toLocaleString('zh-CN');
    $(`${prefix}-bar`).style.width = `${counts[type] / max * 100}%`;
  });
}

function currentFilterPool() {
  let result = [...questions];
  const category = $('category-filter').value;
  const type = $('type-filter').value;
  const term = cleanText($('search-input').value).toLowerCase();
  if (category !== '全部') result = result.filter(q => q.category === category);
  if (type !== '全部') result = result.filter(q => q.type === type);
  if (term) result = result.filter(q => cleanText(q.question).toLowerCase().includes(term) || q.options.some(option => cleanText(option).toLowerCase().includes(term)));
  return result;
}
function makePool() {
  if (view === '错题') return getWrongIds().map(id => questions.find(q => q.id === id)).filter(Boolean);
  if (view === '收藏') return state.favorites.map(id => questions.find(q => q.id === id)).filter(Boolean);
  return currentFilterPool();
}
function setPool(nextPool, keepQuestionId = null) {
  pool = nextPool;
  index = keepQuestionId ? Math.max(0, pool.findIndex(q => q.id === keepQuestionId)) : Math.min(index, Math.max(0, pool.length - 1));
  selected.clear();
  renderQuestion();
}
function updateSessionStats() {
  const answeredInPool = pool.filter(q => state.answers[q.id]).length;
  const correctInPool = pool.filter(q => state.answers[q.id]?.lastCorrect).length;
  const wrongInPool = answeredInPool - correctInPool;
  $('session-total').textContent = pool.length.toLocaleString('zh-CN');
  $('session-done').textContent = answeredInPool.toLocaleString('zh-CN');
  $('session-correct').textContent = correctInPool.toLocaleString('zh-CN');
  $('session-wrong').textContent = wrongInPool.toLocaleString('zh-CN');
  const percent = pool.length ? answeredInPool / pool.length * 100 : 0;
  $('aside-progress').style.width = `${percent}%`;
  $('session-progress').style.width = `${pool.length ? (index + 1) / pool.length * 100 : 0}%`;
  $('session-position').textContent = `${pool.length ? index + 1 : 0} / ${pool.length}`;
  $('prev-button').disabled = index <= 0;
  $('next-button').disabled = index >= pool.length - 1;
}
function renderQuestion() {
  updateSessionStats();
  const q = pool[index];
  const list = $('options-list'); list.replaceChildren();
  $('answer-feedback').textContent = '';
  $('answer-feedback').className = 'answer-feedback';
  if (!q) {
    $('question-index').textContent = '暂无题目';
    $('question-type').textContent = '';
    $('question-text').textContent = view === '错题' ? '这里还没有错题，继续练习保持状态。' : view === '收藏' ? '收藏夹还是空的，遇到想记住的题目时点一下星标。' : '没有找到符合条件的题目，试试调整筛选条件。';
    $('multi-hint').textContent = '';
    $('submit-button').disabled = true;
    $('bookmark-button').disabled = true;
    $('bookmark-button').classList.remove('saved');
    $('bookmark-button').textContent = '☆';
    return;
  }
  $('submit-button').disabled = false;
  $('bookmark-button').disabled = false;
  $('question-index').textContent = `第 ${index + 1} 题`;
  $('question-type').textContent = q.type;
  $('question-text').textContent = cleanText(q.question);
  $('multi-hint').textContent = q.type === '多选' ? '多选题 · 请选择全部正确项' : '选择答案后提交';
  const favorited = state.favorites.includes(q.id);
  $('bookmark-button').textContent = favorited ? '★' : '☆';
  $('bookmark-button').classList.toggle('saved', favorited);
  const prior = state.answers[q.id];
  const chosen = prior?.lastSelection ? new Set(prior.lastSelection) : new Set();
  q.options.forEach((option, i) => {
    const letter = LETTERS[i];
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'option'; button.dataset.letter = letter;
    button.setAttribute('aria-pressed', String(chosen.has(letter)));
    if (chosen.has(letter)) button.classList.add(prior?.lastAt ? (prior.lastCorrect ? 'correct' : 'incorrect') : 'selected');
    if (prior?.lastAt && correctAnswer(q).includes(letter)) button.classList.add('correct');
    button.innerHTML = `<span class="option-key">${letter}</span><span>${escapeHTML(cleanText(option))}</span>`;
    button.addEventListener('click', () => toggleOption(letter));
    list.append(button);
  });
  selected = new Set(prior?.lastAt ? [] : chosen);
  if (prior?.lastAt) {
    const feedback = $('answer-feedback');
    feedback.classList.add(prior.lastCorrect ? 'correct' : 'wrong');
    feedback.textContent = prior.lastCorrect ? '回答正确，继续保持。' : `正确答案：${answerLabel(q)}`;
    $('submit-button').textContent = '再练一次';
    $('multi-hint').textContent = `上次作答：${[...(prior.lastSelection || [])].join('、') || '未记录'}`;
  } else {
    $('submit-button').innerHTML = '确认答案 <span>↗</span>';
  }
}
function toggleOption(letter) {
  const q = pool[index]; if (!q || state.answers[q.id]?.lastAt) return;
  if (q.type === '多选') selected.has(letter) ? selected.delete(letter) : selected.add(letter);
  else selected = new Set([letter]);
  document.querySelectorAll('.option').forEach(button => {
    const on = selected.has(button.dataset.letter);
    button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on));
  });
}
function submitAnswer() {
  const q = pool[index]; if (!q) return;
  const previous = state.answers[q.id];
  if (previous?.lastAt) { selected.clear(); previous.lastAt = null; persist(); renderQuestion(); return; }
  if (!selected.size) { showToast('先选择一个答案'); return; }
  const selection = [...selected].sort().join('');
  const isCorrect = selection === correctAnswer(q);
  const day = todayKey();
  const entry = previous || { attempts: 0, correctCount: 0 };
  entry.attempts = (entry.attempts || 0) + 1;
  if (isCorrect) entry.correctCount = (entry.correctCount || 0) + 1;
  entry.lastCorrect = isCorrect;
  entry.lastSelection = [...selected].sort();
  entry.lastAt = new Date().toISOString();
  state.answers[q.id] = entry;
  if (!state.studyDays.includes(day)) state.studyDays.push(day);
  persist(); updateOverview(); renderQuestion();
}
function setView(nextView) {
  view = nextView;
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === nextView));
  $('view-label').textContent = nextView === '练习' ? '开始练习' : nextView === '错题' ? '错题复习' : nextView === '收藏' ? '我的收藏' : nextView === '考试' ? '模拟考试' : '学习统计';
  $('practice-view').hidden = !['练习','错题','收藏'].includes(nextView);
  $('special-view').hidden = nextView !== '统计';
  $('exam-view').hidden = nextView !== '考试';
  if (nextView === '练习') {
    $('practice-title').textContent = '开始练习'; $('practice-caption').textContent = '按顺序扎实掌握题库内容';
    $('shuffle-button').hidden = false;
    setPool(currentFilterPool());
  } else if (nextView === '错题' || nextView === '收藏') {
    $('practice-title').textContent = nextView === '错题' ? '错题复习' : '我的收藏';
    $('practice-caption').textContent = nextView === '错题' ? '把不确定的地方，再认真练一遍' : '随时回看你标记的重要题目';
    $('shuffle-button').hidden = true;
    setPool(makePool());
  } else if (nextView === '考试') {
    renderExam();
  } else {
    renderReport();
  }
  updateOverview();
}
function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function examItems() {
  return (state.exam?.questionIds || []).map(id => questions.find(q => q.id === id)).filter(Boolean);
}
function formatRemaining() {
  const left = Math.max(0, state.exam.status === 'paused' ? state.exam.remainingMs : EXAM_LIMIT_MS - (Date.now() - state.exam.startedAt));
  const minutes = Math.floor(left / 60000).toString().padStart(2, '0');
  const seconds = Math.floor((left % 60000) / 1000).toString().padStart(2, '0');
  return { left, label: `${minutes}:${seconds}` };
}
function getExamQuotas(practicalPercent) {
  const practicalTotal = Math.round(80 * practicalPercent / 100);
  const parts = EXAM_PLAN.map(([type, total], order) => {
    const exact = practicalTotal * total / 80;
    const practical = Math.floor(exact);
    return { type, total, practical, remainder: exact - practical, order };
  });
  let unassigned = practicalTotal - parts.reduce((sum, row) => sum + row.practical, 0);
  [...parts].sort((a, b) => b.remainder - a.remainder || a.order - b.order).slice(0, unassigned).forEach(row => row.practical++);
  return Object.fromEntries(parts.map(row => [row.type, { practical: row.practical, laws: row.total - row.practical, total: row.total }]));
}
function updateExamRatio(value) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  state.examRatio = percent;
  persist();
  const slider = $('exam-practice-ratio');
  const number = $('exam-practice-percent');
  if (!slider || !number) return;
  slider.value = String(percent); number.value = String(percent);
  $('practical-percent-label').textContent = `${percent}%`;
  $('laws-percent-label').textContent = `${100 - percent}%`;
  const quotas = getExamQuotas(percent);
  $('exam-quota-rows').innerHTML = EXAM_PLAN.map(([type]) => `<div class="exam-quota-row"><span>${type}</span><b>${quotas[type].practical}</b><b>${quotas[type].laws}</b><span>${quotas[type].total}</span></div>`).join('');
  $('exam-practical-total').textContent = String(Object.values(quotas).reduce((sum, row) => sum + row.practical, 0));
  $('exam-laws-total').textContent = String(Object.values(quotas).reduce((sum, row) => sum + row.laws, 0));
  document.querySelectorAll('[data-exam-ratio]').forEach(button => button.classList.toggle('active', Number(button.dataset.examRatio) === percent));
}
function renderExam() {
  if (!questions.length) { $('exam-view').innerHTML = '<div class="exam-empty">题库载入完成后即可开始模拟考试。</div>'; return; }
  if (state.exam?.status === 'active') { renderActiveExam(); return; }
  if (state.exam?.status === 'paused') { renderPausedExam(); return; }
  if (state.exam?.status === 'result') { renderExamResult(state.exam); return; }
  const latest = state.examHistory.at(-1);
  const practicalAvailable = questions.filter(q => q.category === '施工安全实务').length;
  const lawsAvailable = questions.filter(q => q.category === '安全生产法规').length;
  const initialPercent = Number.isInteger(state.examRatio) ? state.examRatio : Math.round(practicalAvailable / questions.length * 100);
  $('exam-view').innerHTML = `<section class="exam-intro"><div class="exam-intro-copy"><p class="eyebrow"><span class="eyebrow-line"></span>限时实战 · 完整作答后阅卷</p><h2>模拟考试</h2><p>开始前自选实务与法规比例，按题库比例随机组卷，完成 80 道题后查看正确率。</p></div><div class="exam-emblem"><span>60</span><small>分钟</small></div></section><section class="exam-specs"><div><strong>80</strong><span>道试题</span></div><div><strong>60</strong><span>分钟限时</span></div><div><strong>100</strong><span>满分</span></div></section><section class="exam-ratio"><div class="exam-ratio-head"><div><h3>选择本场实务 / 法规比例</h3><p>题库现有实务 ${practicalAvailable} 题 · 法规 ${lawsAvailable} 题</p></div><div class="exam-ratio-values"><span><b id="practical-percent-label">—</b> 实务</span><span><b id="laws-percent-label">—</b> 法规</span></div></div><div class="exam-ratio-controls"><label for="exam-practice-ratio">实务占比</label><input id="exam-practice-ratio" type="range" min="0" max="100" step="1" value="${initialPercent}" aria-label="实务题占比"><label class="ratio-number-label" for="exam-practice-percent"><input id="exam-practice-percent" type="number" min="0" max="100" step="1" value="${initialPercent}"><span>%</span></label></div><div class="exam-ratio-presets"><span>快速选择</span><button type="button" data-exam-ratio="50">50 / 50</button><button type="button" data-exam-ratio="${Math.round(practicalAvailable / questions.length * 100)}">按题库比例</button><button type="button" data-exam-ratio="70">70 / 30</button></div><div class="exam-quota-table"><div class="exam-quota-head"><span>题型</span><span>实务</span><span>法规</span><span>合计</span></div><div id="exam-quota-rows"></div><div class="exam-quota-row exam-quota-total"><strong>总题数</strong><strong id="exam-practical-total">0</strong><strong id="exam-laws-total">0</strong><strong>80</strong></div></div><p class="exam-ratio-note">题型总数固定为单选 30、判断 30、多选 20；各题型按所选比例分配，取整后保证合计 80 题。</p></section><section class="exam-plan"><h3>考试规则</h3><p>每题 1.25 分；答错或未作答均不计分。交卷后显示总正确率、分题型和分科目成绩，以及逐题对照。</p></section><div class="exam-start-row"><button class="button-primary exam-start" id="start-exam" type="button">开始 60 分钟考试 <span>↗</span></button>${latest ? `<span>上次成绩 <b>${latest.correct}/${latest.total}</b> · 正确率 <b>${Math.round(latest.correct / latest.total * 100)}%</b></span>` : '<span>考试记录只保存在此设备</span>'}</div>`;
  updateExamRatio(initialPercent);
  $('exam-practice-ratio').addEventListener('input', event => updateExamRatio(event.target.value));
  $('exam-practice-percent').addEventListener('input', event => updateExamRatio(event.target.value));
  document.querySelectorAll('[data-exam-ratio]').forEach(button => button.addEventListener('click', () => updateExamRatio(button.dataset.examRatio)));
  $('start-exam').addEventListener('click', startExam);
}
function startExam() {
  const ids = [];
  const practicalPercent = Number.isInteger(state.examRatio) ? state.examRatio : 61;
  const quotas = getExamQuotas(practicalPercent);
  for (const [type] of EXAM_PLAN) {
    for (const [category, count] of [['施工安全实务', quotas[type].practical], ['安全生产法规', quotas[type].laws]]) {
      const set = shuffled(questions.filter(q => q.type === type && q.category === category));
      if (set.length < count) { showToast(`${category}的${type}题数量不足，无法按此比例组卷`); return; }
      ids.push(...set.slice(0, count).map(q => q.id));
    }
  }
  state.exam = { status: 'active', startedAt: Date.now(), practicalPercent, quotas, questionIds: shuffled(ids), answers: {} };
  examIndex = 0; persist(); renderExam();
}
function renderPausedExam() {
  const answered = Object.keys(state.exam.answers || {}).length;
  const { label } = formatRemaining();
  $('exam-view').innerHTML = `<section class="exam-paused"><p class="eyebrow"><span class="eyebrow-line"></span>本场已保存</p><h2>考试已暂停</h2><p>已作答 ${answered} / 80 题 · 剩余时间 ${label}</p><p>再次进入时会从第 ${Math.min(80, (state.exam.currentIndex || 0) + 1)} 题继续，答案和计时都已保存在此设备。</p><div class="exam-paused-actions"><button class="button-primary" id="resume-exam" type="button">继续考试 <span>↗</span></button><button class="button-secondary" id="restart-paused-exam" type="button">重新开始</button></div></section>`;
  $('resume-exam').addEventListener('click', resumeExam);
  $('restart-paused-exam').addEventListener('click', () => {
    if (!window.confirm('重新开始会清除本场已保存的答案，确定重新开始吗？')) return;
    state.exam = null;
    persist();
    renderExam();
  });
}
function pauseExam() {
  if (state.exam?.status !== 'active') return;
  state.exam.remainingMs = formatRemaining().left;
  state.exam.currentIndex = examIndex;
  state.exam.status = 'paused';
  persist();
  renderExam();
  showToast('本场考试已保存，可以稍后继续');
}
function resumeExam() {
  if (state.exam?.status !== 'paused') return;
  state.exam.startedAt = Date.now() - (EXAM_LIMIT_MS - state.exam.remainingMs);
  state.exam.status = 'active';
  examIndex = Math.max(0, Math.min(79, state.exam.currentIndex || 0));
  persist();
  renderActiveExam();
}
function renderActiveExam() {
  const items = examItems();
  if (items.length !== 80) { $('exam-view').innerHTML = '<div class="exam-empty">本场题目数据不完整，请重新开始考试。</div>'; return; }
  const q = items[examIndex];
  const current = new Set(state.exam.answers[q.id] || []);
  const answered = Object.keys(state.exam.answers).length;
  const { label } = formatRemaining();
  const letters = LETTERS.slice(0, q.options.length);
  $('exam-view').innerHTML = `<div class="exam-head"><div><p class="eyebrow"><span class="eyebrow-line"></span>模拟考试 · 第 ${examIndex + 1} / 80 题</p><h2>专注作答</h2></div><div class="exam-head-actions"><div class="exam-timer" id="exam-timer" aria-live="polite"><span>剩余时间</span><strong>${label}</strong></div><button class="button-secondary exam-save" id="save-exam" type="button">保存并退出</button></div></div><div class="exam-body"><div class="exam-question-panel"><div class="exam-question-meta"><span>第 ${examIndex + 1} 题</span><span class="question-type">${q.type}</span><span class="exam-answer-state">${state.exam.answers[q.id] ? '已作答' : '待作答'}</span></div><h3>${escapeHTML(cleanText(q.question))}</h3><div class="exam-options">${q.options.map((option, i) => `<button class="option exam-option ${current.has(letters[i]) ? 'selected' : ''}" type="button" data-exam-letter="${letters[i]}" aria-pressed="${current.has(letters[i])}"><span class="option-key">${letters[i]}</span><span>${escapeHTML(cleanText(option))}</span></button>`).join('')}</div><p class="exam-multi-hint">${q.type === '多选' ? '多选题 · 请选择全部正确项' : '选择一个答案'}</p><div class="exam-nav"><button class="button-secondary" id="exam-prev" type="button" ${examIndex === 0 ? 'disabled' : ''}>← 上一题</button><span>${answered} / 80 题已作答</span><button class="button-secondary" id="exam-next" type="button" ${examIndex === 79 ? 'disabled' : ''}>下一题 →</button></div></div><aside class="exam-question-map"><div class="exam-map-heading"><h3>答题卡</h3><span>${answered}/80</span></div>${EXAM_PLAN.map(([type]) => `<div class="exam-map-type">${type}题 <span>${items.filter(x => x.type === type).length}题</span></div><div class="exam-map-grid">${items.map((item, i) => item.type === type ? `<button type="button" class="exam-map-cell ${i === examIndex ? 'current' : ''} ${state.exam.answers[item.id] ? 'answered' : ''}" data-exam-index="${i}" aria-label="第${i + 1}题${state.exam.answers[item.id] ? '已作答' : '未作答'}">${i + 1}</button>` : '').join('')}</div>`).join('')}<button class="button-primary exam-submit" id="finish-exam" type="button" ${answered < 80 ? 'disabled' : ''}>交卷并查看成绩</button><p class="exam-submit-hint">${answered === 80 ? '所有题目已完成，可以交卷。' : `还有 ${80 - answered} 题未作答`}</p></aside></div>`;
  $('exam-view').querySelectorAll('[data-exam-letter]').forEach(button => button.addEventListener('click', () => {
    const letter = button.dataset.examLetter;
    const selection = new Set(state.exam.answers[q.id] || []);
    if (q.type === '多选') selection.has(letter) ? selection.delete(letter) : selection.add(letter);
    else { selection.clear(); selection.add(letter); }
    if (selection.size) state.exam.answers[q.id] = [...selection].sort(); else delete state.exam.answers[q.id];
    persist(); renderActiveExam();
  }));
  $('exam-view').querySelectorAll('[data-exam-index]').forEach(button => button.addEventListener('click', () => { examIndex = Number(button.dataset.examIndex); state.exam.currentIndex = examIndex; persist(); renderActiveExam(); }));
  $('exam-prev').addEventListener('click', () => { examIndex = Math.max(0, examIndex - 1); state.exam.currentIndex = examIndex; persist(); renderActiveExam(); });
  $('exam-next').addEventListener('click', () => { examIndex = Math.min(79, examIndex + 1); state.exam.currentIndex = examIndex; persist(); renderActiveExam(); });
  $('save-exam').addEventListener('click', pauseExam);
  $('finish-exam').addEventListener('click', () => finishExam(false));
}
function finishExam(timeExpired) {
  if (state.exam?.status !== 'active' || questions.length === 0) return;
  const items = examItems();
  const answers = state.exam.answers;
  const isCorrect = q => [...(answers[q.id] || [])].sort().join('') === correctAnswer(q);
  const correct = items.filter(isCorrect).length;
  const typeResults = EXAM_PLAN.map(([type, total]) => {
    const subset = items.filter(q => q.type === type);
    return { type, total, correct: subset.filter(isCorrect).length };
  });
  const categoryResults = ['施工安全实务','安全生产法规'].map(category => {
    const subset = items.filter(q => q.category === category);
    return { category, total: subset.length, correct: subset.filter(isCorrect).length };
  });
  const result = { status: 'result', startedAt: state.exam.startedAt, completedAt: Date.now(), timeExpired, practicalPercent: state.exam.practicalPercent, questionIds: state.exam.questionIds, answers: { ...answers }, total: 80, correct, typeResults, categoryResults };
  state.exam = result;
  state.examHistory.push({ ...result });
  state.examHistory = state.examHistory.slice(-20);
  persist();
  if (view === '考试') renderExamResult(result);
  if (timeExpired) showToast('考试时间到，已自动交卷');
}
function selectedAnswerLabel(q, letters) {
  if (!letters?.length) return '未作答';
  return letters.map(letter => { const i = LETTERS.indexOf(letter); return i < 0 ? letter : `${letter}. ${q.options[i] || ''}`; }).join('；');
}
function renderExamResult(result) {
  const accuracy = Math.round(result.correct / result.total * 100);
  const seconds = Math.max(0, Math.round((result.completedAt - result.startedAt) / 1000));
  const duration = `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  const items = result.questionIds.map(id => questions.find(q => q.id === id)).filter(Boolean);
  const categoryResults = result.categoryResults?.length ? result.categoryResults : ['施工安全实务','安全生产法规'].map(category => {
    const subset = items.filter(q => q.category === category);
    return { category, total: subset.length, correct: subset.filter(q => [...(result.answers[q.id] || [])].sort().join('') === correctAnswer(q)).length };
  });
  const review = items.map((q, i) => {
    const answer = result.answers[q.id] || [];
    const correct = [...answer].sort().join('') === correctAnswer(q);
    return `<article class="exam-review-row ${correct ? 'is-correct' : 'is-wrong'}"><div class="exam-review-top"><span>第 ${i + 1} 题 · ${q.type}</span><b>${correct ? '答对' : '答错'}</b></div><p>${escapeHTML(cleanText(q.question))}</p><div class="exam-review-answer"><span>你的答案：${escapeHTML(selectedAnswerLabel(q, answer))}</span><strong>正确答案：${escapeHTML(answerLabel(q))}</strong></div></article>`;
  }).join('');
  const categoryBreakdown = categoryResults.map(row => `<div class="exam-breakdown-row"><span>${row.category === '施工安全实务' ? '实务' : '法规'}</span><div class="exam-breakdown-track"><i style="width:${row.total ? Math.round(row.correct / row.total * 100) : 0}%"></i></div><b>${row.correct} / ${row.total}</b><em>${row.total ? Math.round(row.correct / row.total * 100) : 0}%</em></div>`).join('');
  $('exam-view').innerHTML = `<section class="exam-result-hero"><div><p class="eyebrow"><span class="eyebrow-line"></span>${result.timeExpired ? '考试时间结束 · 已自动交卷' : '考试完成 · 成绩已记录'}</p><h2>本场正确率</h2><p>用完整的一场练习，看看现在掌握得怎么样。</p></div><div class="exam-score"><strong>${accuracy}<small>%</small></strong><span>${result.correct} / ${result.total} 题答对</span></div></section><div class="exam-result-meta"><span>用时 <b>${duration}</b></span><span>答题数 <b>${Object.keys(result.answers).length} / 80</b></span><span>实务 / 法规 <b>${categoryResults.map(row => row.total).join(' / ')}</b></span><button class="button-primary" id="restart-exam" type="button">再考一场 <span>↗</span></button></div><section class="exam-breakdown"><h3>分科目正确率</h3>${categoryBreakdown}</section><section class="exam-breakdown exam-type-breakdown"><h3>分题型成绩</h3>${result.typeResults.map(row => `<div class="exam-breakdown-row"><span>${row.type}题</span><div class="exam-breakdown-track"><i style="width:${Math.round(row.correct / row.total * 100)}%"></i></div><b>${row.correct} / ${row.total}</b><em>${Math.round(row.correct / row.total * 100)}%</em></div>`).join('')}</section><details class="exam-review"><summary>查看 80 道题的作答对照</summary><div class="exam-review-list">${review}</div></details>`;
  $('restart-exam').addEventListener('click', startExam);
}
function tickExam() {
  if (state.exam?.status !== 'active') return;
  const { left, label } = formatRemaining();
  const timer = $('exam-timer');
  if (timer) {
    timer.querySelector('strong').textContent = label;
    timer.classList.toggle('is-low', left <= 5 * 60 * 1000);
  }
  if (left <= 0) finishExam(true);
}
function renderReport() {
  const stats = answerStats();
  const totalAnswered = Object.keys(state.answers).length;
  const wrongCount = getWrongIds().length;
  const today = Object.values(state.answers).filter(isAnsweredToday).length;
  $('special-view').innerHTML = `<div class="special-heading"><div><h2>学习统计</h2><p>记录一点一滴的练习，看到稳步向前的自己。</p></div><button class="clear-button" id="reset-data" type="button">重置学习记录</button></div><div class="stat-report"><section class="report-card"><h3>累计练习</h3><span class="report-big">${stats.attempts.toLocaleString('zh-CN')}</span><span class="report-muted">次作答</span><div class="report-row"><span>已练习题目</span><b>${totalAnswered.toLocaleString('zh-CN')} 题</b></div><div class="report-row"><span>答对次数</span><b>${stats.correct.toLocaleString('zh-CN')} 次</b></div><div class="report-row"><span>整体正确率</span><b>${stats.accuracy}%</b></div></section><section class="report-card"><h3>今日与复习</h3><span class="report-big">${today}</span><span class="report-muted">题 · 今日完成</span><div class="report-row"><span>连续学习</span><b>${getStreak()} 天</b></div><div class="report-row"><span>待复习错题</span><b>${wrongCount} 题</b></div><div class="report-row"><span>已收藏题目</span><b>${state.favorites.length} 题</b></div></section></div>`;
  $('reset-data').addEventListener('click', () => {
    if (!window.confirm('确定清除所有答题记录、错题、收藏和连续学习记录吗？')) return;
    state = { answers: {}, favorites: [], studyDays: [], examHistory: [] }; persist(); updateOverview(); renderReport(); showToast('学习记录已清除');
  });
}
function renderSpecialList() {
  const target = view === '错题' ? getWrongIds() : state.favorites;
  const title = view === '错题' ? '错题复习' : '我的收藏';
  const subtitle = view === '错题' ? `有 ${target.length} 道题等你重新掌握。` : `你收藏了 ${target.length} 道题。`;
  $('special-view').innerHTML = `<div class="special-heading"><div><h2>${title}</h2><p>${subtitle}</p></div></div><div class="special-list">${target.length ? target.map(id => {
    const q = questions.find(item => item.id === id); if (!q) return '';
    return `<article class="special-row"><span class="row-tag">${escapeHTML(q.type)}</span><p>${escapeHTML(cleanText(q.question))}</p><button type="button" data-go-question="${escapeHTML(id)}">去练习 ↗</button></article>`;
  }).join('') : `<div class="special-empty">${view === '错题' ? '目前没有错题。先完成几道练习，错题会自动收集在这里。' : '还没有收藏题目。练习时点击右上角的星标即可收藏。'}</div>`}</div>`;
  $('special-view').querySelectorAll('[data-go-question]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.goQuestion;
    setView('练习'); $('category-filter').value = '全部'; $('type-filter').value = '全部'; $('search-input').value = '';
    pool = currentFilterPool(); index = Math.max(0, pool.findIndex(q => q.id === id)); renderQuestion();
  }));
}
function init() {
  $('today-label').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  ['category-filter','type-filter','search-input'].forEach(id => $(id).addEventListener(id === 'search-input' ? 'input' : 'change', () => {
    if (view !== '练习') setView('练习'); else setPool(currentFilterPool());
  }));
  $('shuffle-button').addEventListener('click', () => {
    const shuffled = currentFilterPool();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    setPool(shuffled); showToast('题目顺序已打乱');
  });
  $('submit-button').addEventListener('click', submitAnswer);
  $('skip-button').addEventListener('click', () => { if (index < pool.length - 1) { index++; selected.clear(); renderQuestion(); } });
  $('prev-button').addEventListener('click', () => { if (index > 0) { index--; selected.clear(); renderQuestion(); } });
  $('next-button').addEventListener('click', () => { if (index < pool.length - 1) { index++; selected.clear(); renderQuestion(); } });
  $('bookmark-button').addEventListener('click', () => {
    const q = pool[index]; if (!q) return;
    state.favorites = state.favorites.includes(q.id) ? state.favorites.filter(id => id !== q.id) : [...state.favorites, q.id];
    persist(); updateOverview();
    if (view === '收藏' && !state.favorites.includes(q.id)) setPool(makePool(), pool[index + 1]?.id || pool[index - 1]?.id || null); else renderQuestion();
    showToast(state.favorites.includes(q.id) ? '已加入收藏' : '已取消收藏');
  });
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,select,textarea') || view === '统计') return;
    if (view === '考试' && state.exam?.status === 'active') {
      if (event.key === 'ArrowRight') { examIndex = Math.min(79, examIndex + 1); state.exam.currentIndex = examIndex; persist(); renderActiveExam(); }
      if (event.key === 'ArrowLeft') { examIndex = Math.max(0, examIndex - 1); state.exam.currentIndex = examIndex; persist(); renderActiveExam(); }
      return;
    }
    if (event.key === 'ArrowRight' && index < pool.length - 1) { index++; selected.clear(); renderQuestion(); }
    if (event.key === 'ArrowLeft' && index > 0) { index--; selected.clear(); renderQuestion(); }
    if (event.key === 'Enter' && event.target === document.body) submitAnswer();
  });
  fetch(DATA_INDEX_URL).then(response => { if (!response.ok) throw new Error('题库目录加载失败'); return response.json(); }).then(parts => Promise.all(parts.map(part => fetch(`./questions/${part}`).then(response => { if (!response.ok) throw new Error('题库分片加载失败'); return response.json(); })))).then(data => {
    const types = {1:'单选',2:'多选',3:'判断'};
    questions = data.flat().map(([type, question, options, answer, category], i) => ({id:String(i), type:types[type], question:cleanText(question), options:options.map(cleanText), answer, category:category === 0 ? '施工安全实务' : '安全生产法规'}));
    const categories = [...new Set(questions.map(q => q.category))];
    categories.forEach(category => { const option = document.createElement('option'); option.value = category; option.textContent = category; $('category-filter').append(option); });
    updateOverview(); setPool(questions);
    if (view === '考试') renderExam();
  }).catch(error => {
    $('question-index').textContent = '题库未能载入';
    $('question-text').textContent = `${error.message}。请从 GitHub Pages 链接重新打开页面。`;
    $('options-list').replaceChildren();
  });
  examClock = window.setInterval(tickExam, 1000);
}
init();
