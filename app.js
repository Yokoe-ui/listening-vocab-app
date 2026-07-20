// ============ IndexedDB helper ============
const DB_NAME = 'vocabAppDB';
const DB_VERSION = 1;
const STORE_NAME = 'words';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.id - b.id));
    req.onerror = () => reject(req.error);
  });
}

async function dbAdd(word) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(word);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(word) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(word);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ============ App State ============
let words = [];
let editingId = null;
let recordedBlob = null;
let mediaRecorder = null;
let recordedChunks = [];
let micStream = null;

let testQueue = [];
let testIndex = 0;
let testResults = { known: [], unknown: [] };
let currentTestAudioUrl = null;

// ============ Tabs ============
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'test') {
      resetTestUI();
      updateTestScopeInfo();
    }
  });
});

// ============ Recording ============
const btnRecord = document.getElementById('btn-record');
const recordStatus = document.getElementById('record-status');
const previewAudio = document.getElementById('preview-audio');

function pickSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type));
}

btnRecord.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('このブラウザは録音に対応していません。HTTPS接続で最新のブラウザからアクセスしてください。');
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert('マイクにアクセスできませんでした。ブラウザのマイク許可設定を確認してください。');
    return;
  }
  recordedChunks = [];
  const mimeType = pickSupportedMimeType();
  mediaRecorder = mimeType ? new MediaRecorder(micStream, { mimeType }) : new MediaRecorder(micStream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    previewAudio.src = URL.createObjectURL(recordedBlob);
    previewAudio.style.display = 'block';
    btnRecord.textContent = '● 録音開始';
    btnRecord.classList.remove('recording');
    recordStatus.textContent = '録音済み(保存前にプレビューを確認できます)';
    micStream.getTracks().forEach(t => t.stop());
  };
  mediaRecorder.start();
  btnRecord.textContent = '■ 録音停止';
  btnRecord.classList.add('recording');
  recordStatus.textContent = '録音中...';
});

// ============ Word Form ============
const wordForm = document.getElementById('word-form');
const inputEnglish = document.getElementById('input-english');
const inputJapanese = document.getElementById('input-japanese');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

wordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const english = inputEnglish.value.trim();
  const japanese = inputJapanese.value.trim();

  if (!english) return;

  if (!recordedBlob && editingId === null) {
    alert('発音の録音は必須です。録音してください。');
    return;
  }

  if (editingId !== null) {
    const existing = words.find(w => w.id === editingId);
    const updated = {
      ...existing,
      english,
      japanese,
      audioBlob: recordedBlob || existing.audioBlob,
      updatedAt: Date.now(),
    };
    await dbPut(updated);
    editingId = null;
    btnCancelEdit.style.display = 'none';
  } else {
    await dbAdd({
      english,
      japanese,
      audioBlob: recordedBlob,
      status: 'new',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  resetForm();
  await loadWords();
});

btnCancelEdit.addEventListener('click', () => {
  editingId = null;
  btnCancelEdit.style.display = 'none';
  resetForm();
});

function resetForm() {
  wordForm.reset();
  recordedBlob = null;
  previewAudio.style.display = 'none';
  previewAudio.src = '';
  recordStatus.textContent = '';
}

// ============ Word List ============
const wordListEl = document.getElementById('word-list');
const wordCountEl = document.getElementById('word-count');

async function loadWords() {
  words = await dbGetAll();
  renderWordList();
}

function statusLabel(status) {
  if (status === 'known') return { text: '暗記済み', cls: 'status-known' };
  if (status === 'unknown') return { text: '未暗記', cls: 'status-unknown' };
  return { text: '未テスト', cls: 'status-new' };
}

function renderWordList() {
  wordCountEl.textContent = words.length ? `(${words.length}件)` : '';

  if (words.length === 0) {
    wordListEl.innerHTML = '<div class="empty-state">まだ単語が登録されていません。上のフォームから登録してください。</div>';
    return;
  }

  wordListEl.innerHTML = '';
  words.forEach(word => {
    const item = document.createElement('div');
    item.className = 'word-item';
    const badge = statusLabel(word.status);

    item.innerHTML = `
      <div class="word-main">
        <div class="word-en">${escapeHtml(word.english)}</div>
        ${word.japanese ? `<div class="word-ja">${escapeHtml(word.japanese)}</div>` : ''}
      </div>
      <span class="status-badge ${badge.cls}">${badge.text}</span>
      <div class="word-actions">
        <button class="icon-btn btn-play-word" title="発音を再生">🔊</button>
        <button class="icon-btn btn-edit-word" title="編集">✎</button>
        <button class="icon-btn btn-reset-word" title="ステータスをリセット" ${word.status === 'new' ? 'disabled' : ''}>↺</button>
        <button class="icon-btn danger btn-delete-word" title="削除">🗑</button>
      </div>
    `;

    item.querySelector('.btn-play-word').addEventListener('click', () => playWordAudio(word));
    item.querySelector('.btn-edit-word').addEventListener('click', () => startEditWord(word));
    item.querySelector('.btn-reset-word').addEventListener('click', () => resetWordStatus(word));
    item.querySelector('.btn-delete-word').addEventListener('click', () => deleteWord(word));

    wordListEl.appendChild(item);
  });
}

let listAudioUrl = null;
function playWordAudio(word) {
  if (!word.audioBlob) return;
  if (listAudioUrl) URL.revokeObjectURL(listAudioUrl);
  listAudioUrl = URL.createObjectURL(word.audioBlob);
  const audio = new Audio(listAudioUrl);
  audio.play();
}

function startEditWord(word) {
  editingId = word.id;
  inputEnglish.value = word.english;
  inputJapanese.value = word.japanese || '';
  recordedBlob = null;
  if (word.audioBlob) {
    previewAudio.src = URL.createObjectURL(word.audioBlob);
    previewAudio.style.display = 'block';
    recordStatus.textContent = '既存の録音があります(再録音する場合のみ録音してください)';
  }
  btnCancelEdit.style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function resetWordStatus(word) {
  const updated = { ...word, status: 'new', updatedAt: Date.now() };
  await dbPut(updated);
  await loadWords();
}

async function deleteWord(word) {
  if (!confirm(`「${word.english}」を削除しますか？`)) return;
  await dbDelete(word.id);
  await loadWords();
}

document.getElementById('btn-reset-all').addEventListener('click', async () => {
  if (words.length === 0) return;
  if (!confirm('すべての単語のステータス(暗記済み/未暗記)をリセットしますか？')) return;
  for (const w of words) {
    if (w.status !== 'new') {
      await dbPut({ ...w, status: 'new', updatedAt: Date.now() });
    }
  }
  await loadWords();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============ Test Mode ============
const testSetup = document.getElementById('test-setup');
const testRunner = document.getElementById('test-runner');
const testResult = document.getElementById('test-result');
const testScopeInfo = document.getElementById('test-scope-info');

function getScopeWords(scope) {
  if (scope === 'all') return words.filter(w => w.audioBlob);
  return words.filter(w => w.audioBlob && w.status !== 'known');
}

function getSelectedScope() {
  return document.querySelector('input[name="test-scope"]:checked').value;
}

function updateTestScopeInfo() {
  const scope = getSelectedScope();
  const count = getScopeWords(scope).length;
  testScopeInfo.textContent = `対象の単語数: ${count}件`;
}

document.querySelectorAll('input[name="test-scope"]').forEach(el => {
  el.addEventListener('change', updateTestScopeInfo);
});

document.getElementById('btn-start-test').addEventListener('click', () => {
  const scope = getSelectedScope();
  const pool = getScopeWords(scope);
  if (pool.length === 0) {
    alert('テスト対象の単語がありません。単語を登録するか、出題範囲を変更してください。');
    return;
  }
  testQueue = shuffle([...pool]);
  testIndex = 0;
  testResults = { known: [], unknown: [] };
  testSetup.style.display = 'none';
  testResult.style.display = 'none';
  testRunner.style.display = 'block';
  showTestWord();
});

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const testAudioEl = document.getElementById('test-audio');
const revealArea = document.getElementById('reveal-area');
const answerArea = document.getElementById('answer-area');

function showTestWord() {
  const word = testQueue[testIndex];
  document.getElementById('test-progress-text').textContent = `${testIndex + 1} / ${testQueue.length}`;
  document.getElementById('progress-bar-fill').style.width = `${(testIndex / testQueue.length) * 100}%`;

  revealArea.style.display = 'block';
  answerArea.style.display = 'none';

  if (currentTestAudioUrl) URL.revokeObjectURL(currentTestAudioUrl);
  currentTestAudioUrl = URL.createObjectURL(word.audioBlob);
  testAudioEl.src = currentTestAudioUrl;
  testAudioEl.play().catch(() => {});
}

document.getElementById('btn-play-audio').addEventListener('click', () => {
  testAudioEl.currentTime = 0;
  testAudioEl.play();
});

document.getElementById('btn-reveal').addEventListener('click', () => {
  const word = testQueue[testIndex];
  document.getElementById('reveal-english').textContent = word.english;
  document.getElementById('reveal-japanese').textContent = word.japanese || '';
  revealArea.style.display = 'none';
  answerArea.style.display = 'block';
});

document.getElementById('btn-known').addEventListener('click', () => judgeWord('known'));
document.getElementById('btn-unknown').addEventListener('click', () => judgeWord('unknown'));

async function judgeWord(result) {
  const word = testQueue[testIndex];
  const status = result === 'known' ? 'known' : 'unknown';
  await dbPut({ ...word, status, updatedAt: Date.now() });
  testResults[result].push(word);
  words = words.map(w => w.id === word.id ? { ...w, status } : w);

  testIndex++;
  if (testIndex >= testQueue.length) {
    finishTest();
  } else {
    showTestWord();
  }
}

function finishTest() {
  testRunner.style.display = 'none';
  testResult.style.display = 'block';
  document.getElementById('result-known-count').textContent = testResults.known.length;
  document.getElementById('result-unknown-count').textContent = testResults.unknown.length;

  const listEl = document.getElementById('result-unknown-list');
  if (testResults.unknown.length === 0) {
    listEl.innerHTML = '';
  } else {
    listEl.innerHTML = '<p class="hint">未暗記の単語</p>' + testResults.unknown.map(w =>
      `<div class="result-list-item"><span>${escapeHtml(w.english)}</span><span>${escapeHtml(w.japanese || '')}</span></div>`
    ).join('');
  }
  renderWordList();
}

document.getElementById('btn-retest').addEventListener('click', () => {
  resetTestUI();
  updateTestScopeInfo();
});

document.getElementById('btn-back-to-list').addEventListener('click', () => {
  document.querySelector('.tab-btn[data-tab="list"]').click();
});

function resetTestUI() {
  testSetup.style.display = 'block';
  testRunner.style.display = 'none';
  testResult.style.display = 'none';
}

// ============ Init ============
loadWords();
updateTestScopeInfo();
