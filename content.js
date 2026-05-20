if (!globalThis.coteachTimerLoaded) {
  globalThis.coteachTimerLoaded = true;

  let timerInterval = null;
  let timerIsRunning = false;
  let timerIsPaused = false;
  let selectedSeconds = null;
  let secondsLeft = 0;

  const STORAGE_POSITION_KEY = "coteachTimerPosition";
  const STORAGE_PRESETS_KEY = "coteachTimerPresets";
  const STORAGE_ROOM_KEY = "coteachTimerCurrentRoom";
  const STORAGE_SAVED_ROOMS_KEY = "coteachTimerSavedRooms";
  const STORAGE_CLIENT_ID_KEY = "coteachTimerClientId";
  const MAX_TIMER_SECONDS = 24 * 60 * 60; // 24 hours
const MAX_TIMER_MINUTES = 24 * 60; // 1440 minutes

  let presets = [
    { label: "1 min", seconds: 60 },
    { label: "3 min", seconds: 180 },
    { label: "5 min", seconds: 300 },
    { label: "10 min", seconds: 600 }
  ];

  //Add Firebase Functions

let firebaseAuth = null;
let firebaseUser = null;
let firebaseDatabase = null;
let firebaseTimerRef = null;
let firebaseConnectionRef = null;
let currentRoomId = null;
let currentRoomName = null;
let firebaseIsConnected = false;
let isApplyingRemoteUpdate = false;

//Firebase connection status
//Duplicate listener protection
//Room creation, joining, local only, previous room history

async function getClientId() {
  const result = await chrome.storage.local.get(STORAGE_CLIENT_ID_KEY);
  let clientId = result[STORAGE_CLIENT_ID_KEY];

  if (!clientId) {
    clientId = `client-${crypto.randomUUID()}`;
    await chrome.storage.local.set({
      [STORAGE_CLIENT_ID_KEY]: clientId
    });
  }

  return clientId;
}

function setupFirebase() {
  if (!window.firebase) {
    console.error("Firebase SDK not loaded.");
    return false;
  }

  if (!window.COTEACH_FIREBASE_CONFIG) {
    console.error("Firebase config missing.");
    return false;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(window.COTEACH_FIREBASE_CONFIG);
  }

  firebaseAuth = firebase.auth();
  firebaseDatabase = firebase.database();

  return true;
}

async function ensureSignedIn() {
  const firebaseReady = setupFirebase();

  if (!firebaseReady) {
    return null;
  }

  if (firebaseAuth.currentUser) {
    firebaseUser = firebaseAuth.currentUser;
    return firebaseUser;
  }

  const credential = await firebaseAuth.signInAnonymously();

  firebaseUser = credential.user;
  return firebaseUser;
}


function updateRoomStatus(panel, statusText = "") {
  const { roomStatus } = getElements(panel);

  if (!roomStatus) return;

  if (!currentRoomId) {
    roomStatus.textContent = "";
    return;
  }

  const roomLabel = currentRoomName || currentRoomId;

  if (statusText) {
    roomStatus.textContent = `Room: ${roomLabel} · ${statusText}`;
    return;
  }

  roomStatus.textContent = `Room: ${roomLabel}`;
}

function detachFirebaseListeners() {
  if (firebaseTimerRef) {
    firebaseTimerRef.off();
  }

  if (firebaseConnectionRef) {
    firebaseConnectionRef.off();
  }
}

function writeTimerStateToFirebase(state, options = {}) {
  const forceWrite = options.forceWrite === true;

  if (!firebaseTimerRef) return;

  if (isApplyingRemoteUpdate && !forceWrite) return;

  firebaseTimerRef.update({
    ...state,
    lastUpdated: Date.now()
  });
}

function resetRoomTimerInFirebase() {
  writeTimerStateToFirebase(
    {
      isRunning: false,
      isPaused: false,
      selectedSeconds: null,
      secondsLeft: 0,
      endTime: null
    },
    { forceWrite: true }
  );
}

function listenToFirebaseTimer(panel) {
  if (!firebaseTimerRef) return;

  // Duplicate listener protection
  firebaseTimerRef.off("value");

  firebaseTimerRef.on("value", (snapshot) => {
    const remoteState = snapshot.val();

    if (!remoteState) return;

    isApplyingRemoteUpdate = true;
    applyRemoteTimerState(panel, remoteState);
    isApplyingRemoteUpdate = false;
  });
}

function listenToFirebaseConnection(panel) {
  if (!firebaseDatabase || !currentRoomId) return;

  firebaseConnectionRef = firebaseDatabase.ref(".info/connected");

  // Duplicate listener protection
  firebaseConnectionRef.off("value");

  updateRoomStatus(panel, "Connecting...");

  firebaseConnectionRef.on("value", (snapshot) => {
    firebaseIsConnected = snapshot.val() === true;

    if (firebaseIsConnected) {
      updateRoomStatus(panel, "Connected");
    } else {
      updateRoomStatus(panel, "Offline");
    }
  });
}

async function loadSavedRooms() {
  const result = await chrome.storage.local.get(STORAGE_SAVED_ROOMS_KEY);
  const savedRooms = result[STORAGE_SAVED_ROOMS_KEY];

  if (Array.isArray(savedRooms)) {
    return savedRooms;
  }

  return [];
}

async function getActiveSavedRooms() {
  const savedRooms = await loadSavedRooms();

  if (!savedRooms.length) {
    return [];
  }

  const user = await ensureSignedIn();

if (!user || !firebaseDatabase) {
  return savedRooms;
}

  const activeRooms = [];

  for (const roomId of savedRooms) {
    const cleanRoomId = sanitizeRoomCode(roomId);

    if (!cleanRoomId) continue;

    const metaSnapshot = await firebaseDatabase
      .ref(`rooms/${cleanRoomId}/meta`)
      .get();

    const roomMeta = metaSnapshot.val();

    if (roomMeta && roomMeta.active !== false) {
      activeRooms.push({
        roomId: cleanRoomId,
        displayName: roomMeta.displayName || cleanRoomId
      });
    }
  }

  await chrome.storage.local.set({
    [STORAGE_SAVED_ROOMS_KEY]: activeRooms.map((room) => room.roomId)
  });

  return activeRooms;
}

async function saveRoomToHistory(roomId) {
  const savedRooms = await loadSavedRooms();

  if (!savedRooms.includes(roomId)) {
    savedRooms.push(roomId);
  }

  await chrome.storage.local.set({
    [STORAGE_SAVED_ROOMS_KEY]: savedRooms
  });
}

async function removeRoomFromHistory(roomId) {
  const cleanRoomId = sanitizeRoomCode(roomId);

  if (!cleanRoomId) return;

  const savedRooms = await loadSavedRooms();
  const updatedRooms = savedRooms.filter((savedRoomId) => {
    return sanitizeRoomCode(savedRoomId) !== cleanRoomId;
  });

  await chrome.storage.local.set({
    [STORAGE_SAVED_ROOMS_KEY]: updatedRooms
  });
}

async function saveCurrentRoom(roomId) {
  if (!roomId) {
    await chrome.storage.local.remove(STORAGE_ROOM_KEY);
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_ROOM_KEY]: roomId
  });
}

async function loadCurrentRoom() {
  const result = await chrome.storage.local.get(STORAGE_ROOM_KEY);
  return result[STORAGE_ROOM_KEY] || null;
}

function sanitizeRoomCode(roomCode) {
  return roomCode
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
}

function createRandomRoomCode() {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `poof-${randomPart}`;
}

//Creates specific room if it does not already exist
//Refuses overwriting if room already exists
//Stores a nice display name in Firebase

async function connectToRoom(panel, roomCode, options = {}) {
  const cleanRoomCode = sanitizeRoomCode(roomCode);
  const createIfMissing = options.createIfMissing === true;
  const requireNewRoom = options.requireNewRoom === true;
  const displayName = options.displayName || cleanRoomCode;

  const settingsStatus = panel.querySelector("#settings-status");

  if (!cleanRoomCode) {
    if (settingsStatus) {
      settingsStatus.textContent = "Enter a room code.";
    }
    return false;
  }

  const user = await ensureSignedIn();

if (!user) {
  if (settingsStatus) {
    settingsStatus.textContent = "Could not sign in securely.";
  }
  return false;
}

  detachFirebaseListeners();
  clearTimerInterval();

  const roomRef = firebaseDatabase.ref(`rooms/${cleanRoomCode}`);
  const metaRef = roomRef.child("meta");
  const timerRef = roomRef.child("timer");

  const snapshot = await metaRef.get();
  const roomMeta = snapshot.val();

  if (roomMeta && requireNewRoom) {
    if (settingsStatus) {
      settingsStatus.textContent = `Room "${cleanRoomCode}" already exists. Choose another name or click Join Selected Room to join it.`;
    }
    return false;
  }

  if (!roomMeta && !createIfMissing) {
    if (settingsStatus) {
      settingsStatus.textContent = "That room does not exist yet. Click Create to create it.";
    }
    updateRoomStatus(panel, "");
    return false;
  }

  if (roomMeta?.active === false) {
    if (settingsStatus) {
      settingsStatus.textContent = "That room is no longer active.";
    }
    updateRoomStatus(panel, "");
    return false;
  }

  if (!roomMeta && createIfMissing) {
    const clientId = await getClientId();

    await metaRef.set({
      roomId: cleanRoomCode,
      displayName: displayName,
      ownerClientId: clientId,
      ownerUid: user.uid,
      active: true,
      createdAt: Date.now()
    });

    await timerRef.set({
      isRunning: false,
      isPaused: false,
      selectedSeconds: null,
      secondsLeft: 0,
      endTime: null,
      lastUpdated: Date.now()
    });
  }

  const finalMetaSnapshot = await metaRef.get();
  const finalMeta = finalMetaSnapshot.val();

  currentRoomId = cleanRoomCode;
  currentRoomName = finalMeta?.displayName || cleanRoomCode;
  firebaseTimerRef = timerRef;

  await saveCurrentRoom(currentRoomId);
  await saveRoomToHistory(currentRoomId);

  listenToFirebaseTimer(panel);
  listenToFirebaseConnection(panel);

  renderRoomChoices(panel);

  if (settingsStatus) {
    settingsStatus.textContent = `Connected to ${currentRoomName}. Code: ${currentRoomId}`;
  }

  return true;
}

async function useLocalTimer(panel) {
  detachFirebaseListeners();
  clearTimerInterval();

  currentRoomId = null;
  currentRoomName = null;
  firebaseTimerRef = null;
  firebaseConnectionRef = null;
  firebaseIsConnected = false;

  timerIsRunning = false;
  timerIsPaused = false;
  selectedSeconds = null;
  secondsLeft = 0;

  await saveCurrentRoom(null);

  updateRoomStatus(panel, "");

  const settingsStatus = panel.querySelector("#settings-status");

  if (settingsStatus) {
    settingsStatus.textContent = "Using local timer only.";
  }

  renderRoomChoices(panel);
  updateReadyState(panel, "Local timer only");
}

async function createNewRoom(panel) {
  const { roomCodeInput } = getElements(panel);

  const typedRoomName = roomCodeInput?.value?.trim() || "";
  const roomCodeToCreate = typedRoomName
    ? sanitizeRoomCode(typedRoomName)
    : createRandomRoomCode();

  const displayName = typedRoomName || roomCodeToCreate;

  await connectToRoom(panel, roomCodeToCreate, {
    createIfMissing: true,
    requireNewRoom: true,
    displayName
  });
}


function applyRemoteTimerState(panel, state) {
  clearTimerInterval();

  timerIsRunning = Boolean(state.isRunning);
  timerIsPaused = Boolean(state.isPaused);
  selectedSeconds = Number(state.selectedSeconds) || null;
  secondsLeft = Number(state.secondsLeft) || 0;

  if (timerIsRunning && state.endTime) {
  secondsLeft = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));

  if (secondsLeft <= 0) {
    finishTimer(panel);
    resetRoomTimerInFirebase();
    return;
  }

  updateRunningState(panel);
  startRemoteCountdown(panel, state.endTime);
  return;
}

  if (timerIsPaused) {
    updatePausedState(panel);
    return;
  }

  if (selectedSeconds && secondsLeft > 0) {
    updateReadyState(panel, "Ready from room");
    return;
  }

  selectedSeconds = null;
  secondsLeft = 0;
  updateReadyState(panel, "Choose a time");
}

function startRemoteCountdown(panel, endTime) {
  clearTimerInterval();

  timerInterval = setInterval(() => {
    secondsLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    setDisplay(panel, formatTime(secondsLeft), "Timer Running");

    if (secondsLeft <= 0) {
  finishTimer(panel);
  resetRoomTimerInFirebase();
}
  }, 250);
}



  function formatTime(totalSeconds) {
    const safeSeconds = Math.max(0, totalSeconds);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatPresetLabel(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0 && seconds > 0) {
      return `${minutes}m ${seconds}s`;
    }

    if (minutes > 0) {
      return `${minutes} min`;
    }

    return `${seconds} sec`;
  }

  function getElements(panel) {
    return {
      closeBtn: panel.querySelector("#coteach-close-btn"),
      settingsBtn: panel.querySelector("#coteach-settings-btn"),
      timerView: panel.querySelector("#coteach-timer-view"),
      settingsView: panel.querySelector("#coteach-settings-view"),
      roomStatus: panel.querySelector("#coteach-room-status"),

      roomChoiceSelect: panel.querySelector("#room-choice-select"),
      roomCodeInput: panel.querySelector("#room-code-input"),
      applyRoomBtn: panel.querySelector("#apply-room-btn"),
      createRoomBtn: panel.querySelector("#create-room-btn"),
      localRoomBtn: panel.querySelector("#local-room-btn"),
      removeSavedRoomBtn: panel.querySelector("#remove-saved-room-btn"),

      timeDisplay: panel.querySelector("#coteach-time"),
      labelDisplay: panel.querySelector("#coteach-label"),
      presetButtons: panel.querySelectorAll(".preset-btn"),
      customMinutesInput: panel.querySelector("#custom-minutes"),
      customSecondsInput: panel.querySelector("#custom-seconds"),
      startBtn: panel.querySelector("#start-btn"),
      pauseBtn: panel.querySelector("#pause-btn"),
      stopBtn: panel.querySelector("#stop-btn"),
      savePresetsBtn: panel.querySelector("#save-presets-btn"),
      cancelSettingsBtn: panel.querySelector("#cancel-settings-btn")
    };
  }

  function setDisplay(panel, timeText, labelText) {
    const { timeDisplay, labelDisplay } = getElements(panel);

    timeDisplay.textContent = timeText;
    labelDisplay.textContent = labelText;
  }

  function clearTimerInterval() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function clearCustomInputs(panel) {
    const { customMinutesInput, customSecondsInput } = getElements(panel);

    customMinutesInput.value = "";
    customSecondsInput.value = "";
  }

  function setExpandedControlsEnabled(panel, enabled) {
    const {
      presetButtons,
      customMinutesInput,
      customSecondsInput
    } = getElements(panel);

    presetButtons.forEach((button) => {
      button.disabled = !enabled;
    });

    customMinutesInput.disabled = !enabled;
    customSecondsInput.disabled = !enabled;
  }

  async function loadPresets() {
    const result = await chrome.storage.local.get(STORAGE_PRESETS_KEY);
    const savedPresets = result[STORAGE_PRESETS_KEY];

    if (Array.isArray(savedPresets) && savedPresets.length === 4) {
      presets = savedPresets;
    }
  }

  async function savePresets(newPresets) {
    presets = newPresets;

    await chrome.storage.local.set({
      [STORAGE_PRESETS_KEY]: presets
    });
  }

  function renderPresetButtons(panel) {
    const presetButtons = panel.querySelectorAll(".preset-btn");

    presetButtons.forEach((button, index) => {
      const preset = presets[index];

      button.textContent = preset.label;
      button.dataset.seconds = preset.seconds;
    });
  }

  //Creates dropdown to dynamically show 
  //local timer only, create new room, join poof-a1b2c3, join test-room-1
  async function renderRoomChoices(panel) {
  const { roomChoiceSelect, roomCodeInput } = getElements(panel);

  if (!roomChoiceSelect) return;

  const activeRooms = await getActiveSavedRooms();

  roomChoiceSelect.innerHTML = "";

  const localOption = document.createElement("option");
  localOption.value = "local";
  localOption.textContent = "Local timer only";
  roomChoiceSelect.appendChild(localOption);

  const createOption = document.createElement("option");
  createOption.value = "create-new";
  createOption.textContent = "Create a new room";
  roomChoiceSelect.appendChild(createOption);

  activeRooms.forEach((room) => {
    const option = document.createElement("option");
    option.value = `room:${room.roomId}`;
    option.textContent = `Join ${room.displayName}`;
    roomChoiceSelect.appendChild(option);
  });

  if (currentRoomId) {
    const currentRoomStillExists = activeRooms.some(
      (room) => room.roomId === currentRoomId
    );

    if (currentRoomStillExists) {
      roomChoiceSelect.value = `room:${currentRoomId}`;
    } else {
      roomChoiceSelect.value = "local";
    }
  } else {
    roomChoiceSelect.value = "local";
  }

  if (roomCodeInput) {
    roomCodeInput.value = "";
  }
}


  function fillSettingsInputs(panel) {
    presets.forEach((preset, index) => {
      const minutesInput = panel.querySelector(`#preset-${index + 1}-minutes`);
      const secondsInput = panel.querySelector(`#preset-${index + 1}-seconds`);

      minutesInput.value = Math.floor(preset.seconds / 60);
      secondsInput.value = preset.seconds % 60;
    });
  }

async function openSettings(panel) {
  const {
    timerView,
    settingsView,
    settingsBtn,
    savePresetsBtn
  } = getElements(panel);

  fillSettingsInputs(panel);
  await renderRoomChoices(panel);

  timerView.classList.add("hidden");
  settingsView.classList.remove("hidden");

  settingsBtn.disabled = true;

  const presetInputs = settingsView.querySelectorAll(
    "#preset-1-minutes, #preset-1-seconds, #preset-2-minutes, #preset-2-seconds, #preset-3-minutes, #preset-3-seconds, #preset-4-minutes, #preset-4-seconds"
  );

  if (timerIsRunning || timerIsPaused) {
    savePresetsBtn.disabled = true;

    presetInputs.forEach((input) => {
      input.disabled = true;
    });
  } else {
    savePresetsBtn.disabled = false;

    presetInputs.forEach((input) => {
      input.disabled = false;
    });
  }
}

  function closeSettings(panel) {
  const { timerView, settingsView, settingsBtn } = getElements(panel);

  settingsView.classList.add("hidden");
  timerView.classList.remove("hidden");
  settingsBtn.disabled = false;

  if (timerIsRunning) {
    updateRunningState(panel);
    return;
  }

  if (timerIsPaused) {
    updatePausedState(panel);
    return;
  }

  updateReadyState(panel);
}

  function collectPresetSettings(panel) {
    const newPresets = [];

    for (let index = 1; index <= 4; index++) {
      const minutesInput = panel.querySelector(`#preset-${index}-minutes`);
      const secondsInput = panel.querySelector(`#preset-${index}-seconds`);

      const minutes = Number(minutesInput.value) || 0;
      const seconds = Number(secondsInput.value) || 0;
      const totalSeconds = minutes * 60 + seconds;

      if (totalSeconds > MAX_TIMER_SECONDS) {
  return {
    error: `Preset ${index}: max timer is 24 hours.`
  };
}

      if (seconds > 59) {
        return {
          error: `Preset ${index}: seconds must be 0-59.`
        };
      }

      if (totalSeconds <= 0) {
        return {
          error: `Preset ${index}: enter a time greater than 0.`
        };
      }

      newPresets.push({
        label: formatPresetLabel(totalSeconds),
        seconds: totalSeconds
      });
    }

    return {
      presets: newPresets
    };
  }

  function updateReadyState(panel, labelText = "Choose a time") {
    const { startBtn, pauseBtn, settingsBtn } = getElements(panel);

    timerIsRunning = false;
    timerIsPaused = false;

    panel.classList.remove("compressed");

    pauseBtn.classList.add("hidden");
    pauseBtn.disabled = true;

    startBtn.textContent = "Start";
    startBtn.disabled = !selectedSeconds;

    settingsBtn.disabled = false;

    setExpandedControlsEnabled(panel, true);

    if (selectedSeconds) {
      setDisplay(panel, formatTime(secondsLeft), labelText);
    } else {
      setDisplay(panel, "00:00", labelText);
    }
  }

  function updateRunningState(panel) {
    const { startBtn, pauseBtn, settingsBtn } = getElements(panel);

    panel.classList.add("compressed");

    pauseBtn.classList.remove("hidden");
    pauseBtn.disabled = false;

    startBtn.textContent = "Start";
    startBtn.disabled = true;

    settingsBtn.disabled = false;

    setExpandedControlsEnabled(panel, false);

    setDisplay(panel, formatTime(secondsLeft), "Timer Running");
  }

  function updatePausedState(panel) {
    const { startBtn, pauseBtn, settingsBtn } = getElements(panel);

    panel.classList.add("compressed");

    pauseBtn.classList.remove("hidden");
    pauseBtn.disabled = true;

    startBtn.textContent = "Resume";
    startBtn.disabled = false;

    settingsBtn.disabled = false;

    setExpandedControlsEnabled(panel, false);

    setDisplay(panel, formatTime(secondsLeft), "Paused");
  }

function chooseTime(panel, totalSeconds, labelText) {
  if (timerIsRunning || timerIsPaused) return;

  if (totalSeconds > MAX_TIMER_SECONDS) {
  selectedSeconds = null;
  secondsLeft = 0;
  updateReadyState(panel, "Max timer is 24 hours");
  return;
}

  if (totalSeconds <= 0) {
    selectedSeconds = null;
    secondsLeft = 0;
    updateReadyState(panel, "Choose a time");

    writeTimerStateToFirebase({
      isRunning: false,
      isPaused: false,
      selectedSeconds: null,
      secondsLeft: 0,
      endTime: null
    });

    return;
  }

  selectedSeconds = totalSeconds;
  secondsLeft = totalSeconds;

  updateReadyState(panel, labelText);

  writeTimerStateToFirebase({
    isRunning: false,
    isPaused: false,
    selectedSeconds,
    secondsLeft,
    endTime: null
  });
}

  function updateCustomTimeFromInputs(panel) {
    if (timerIsRunning || timerIsPaused) return;

    const {
      customMinutesInput,
      customSecondsInput
    } = getElements(panel);

    let minutes = Number(customMinutesInput.value) || 0;
    const seconds = Number(customSecondsInput.value) || 0;

    if (minutes > MAX_TIMER_MINUTES) {
  minutes = MAX_TIMER_MINUTES;
  customMinutesInput.value = String(MAX_TIMER_MINUTES);
}

    if (seconds > 59) {
      selectedSeconds = null;
      secondsLeft = 0;
      updateReadyState(panel, "Seconds must be 0-59");
      return;
    }

    const totalSeconds = minutes * 60 + seconds;

    if (totalSeconds > MAX_TIMER_SECONDS) {
  selectedSeconds = null;
  secondsLeft = 0;
  updateReadyState(panel, "Max timer is 24 hours");
  return;
    }

    if (totalSeconds <= 0) {
      selectedSeconds = null;
      secondsLeft = 0;
      updateReadyState(panel, "Choose a time");
      return;
    }

    chooseTime(panel, totalSeconds, "Custom time ready");
  }

  function finishTimer(panel) {
    clearTimerInterval();

    selectedSeconds = null;
    secondsLeft = 0;

    clearCustomInputs(panel);
    updateReadyState(panel, "Time's up!");
  }

  function startInterval(panel) {
    clearTimerInterval();

    timerInterval = setInterval(() => {
      secondsLeft--;
      setDisplay(panel, formatTime(secondsLeft), "Timer Running");

      if (secondsLeft <= 0) {
        finishTimer(panel);
      }
    }, 1000);
  }

function startOrResumeTimer(panel) {
  if (timerIsRunning) return;

  if (timerIsPaused && secondsLeft > 0) {
    const endTime = Date.now() + secondsLeft * 1000;

    timerIsRunning = true;
    timerIsPaused = false;

    updateRunningState(panel);
    startRemoteCountdown(panel, endTime);

    writeTimerStateToFirebase({
      isRunning: true,
      isPaused: false,
      selectedSeconds,
      secondsLeft,
      endTime
    });

    return;
  }

  if (!selectedSeconds || selectedSeconds <= 0) return;

  secondsLeft = selectedSeconds;

  const endTime = Date.now() + secondsLeft * 1000;

  timerIsRunning = true;
  timerIsPaused = false;

  updateRunningState(panel);
  startRemoteCountdown(panel, endTime);

  writeTimerStateToFirebase({
    isRunning: true,
    isPaused: false,
    selectedSeconds,
    secondsLeft,
    endTime
  });
}

function pauseTimer(panel) {
  if (!timerIsRunning) return;

  clearTimerInterval();

  timerIsRunning = false;
  timerIsPaused = true;

  updatePausedState(panel);

  writeTimerStateToFirebase({
    isRunning: false,
    isPaused: true,
    selectedSeconds,
    secondsLeft,
    endTime: null
  });
}

function stopTimer(panel) {
  clearTimerInterval();

  timerIsRunning = false;
  timerIsPaused = false;
  selectedSeconds = null;
  secondsLeft = 0;

  closeSettings(panel);
  clearCustomInputs(panel);
  updateReadyState(panel, "Choose a time");

  writeTimerStateToFirebase({
    isRunning: false,
    isPaused: false,
    selectedSeconds: null,
    secondsLeft: 0,
    endTime: null
  });
}

  async function savePanelPosition(panel) {
    await chrome.storage.local.set({
      [STORAGE_POSITION_KEY]: {
        left: panel.style.left,
        top: panel.style.top
      }
    });
  }

  async function restorePanelPosition(panel) {
    const result = await chrome.storage.local.get(STORAGE_POSITION_KEY);
    const savedPosition = result[STORAGE_POSITION_KEY];

    if (savedPosition?.left && savedPosition?.top) {
      panel.style.left = savedPosition.left;
      panel.style.top = savedPosition.top;
      panel.style.right = "auto";
    }
  }

  function makePanelDraggable(panel) {
    const header = panel.querySelector("#coteach-header");

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener("mousedown", (event) => {
      if (
        event.target.id === "coteach-close-btn" ||
        event.target.id === "coteach-settings-btn"
      ) {
        return;
      }

      isDragging = true;
      offsetX = event.clientX - panel.offsetLeft;
      offsetY = event.clientY - panel.offsetTop;
      panel.classList.add("dragging");
    });

    document.addEventListener("mousemove", (event) => {
      if (!isDragging) return;

      const maxLeft = window.innerWidth - panel.offsetWidth;
      const maxTop = window.innerHeight - panel.offsetHeight;

      const newLeft = Math.min(Math.max(0, event.clientX - offsetX), Math.max(0, maxLeft));
      const newTop = Math.min(Math.max(0, event.clientY - offsetY), Math.max(0, maxTop));

      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
      panel.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;

      isDragging = false;
      panel.classList.remove("dragging");
      savePanelPosition(panel);
    });
  }

  function closeTimerPanel(panel) {
    clearTimerInterval();
    detachFirebaseListeners();
    panel.remove();
  }
  

  function wireUpPanelEvents(panel) {
    const {
  closeBtn,
  settingsBtn,
  presetButtons,
  customMinutesInput,
  customSecondsInput,
  startBtn,
  pauseBtn,
  stopBtn,
  savePresetsBtn,
  cancelSettingsBtn,
  roomChoiceSelect,
  roomCodeInput,
  applyRoomBtn,
  createRoomBtn,
  localRoomBtn,
  removeSavedRoomBtn,
} = getElements(panel);

    closeBtn.addEventListener("click", () => {
    closeTimerPanel(panel);
    });

    settingsBtn.addEventListener("click", async () => {
      await openSettings(panel);
    });

//Gear panel controls room switching

    applyRoomBtn.addEventListener("click", async () => {
  const typedRoomCode = sanitizeRoomCode(roomCodeInput.value);
  const selectedChoice = roomChoiceSelect.value;

  if (typedRoomCode) {
    await connectToRoom(panel, typedRoomCode, { createIfMissing: false });
    return;
  }

  if (selectedChoice === "local") {
    await useLocalTimer(panel);
    return;
  }

  if (selectedChoice === "create-new") {
    await createNewRoom(panel);
    return;
  }

  if (selectedChoice.startsWith("room:")) {
    const roomId = selectedChoice.replace("room:", "");
    await connectToRoom(panel, roomId, { createIfMissing: false });
  }
});

createRoomBtn.addEventListener("click", async () => {
  await createNewRoom(panel);
});

localRoomBtn.addEventListener("click", async () => {
  await useLocalTimer(panel);
});

removeSavedRoomBtn.addEventListener("click", async () => {
  const settingsStatus = panel.querySelector("#settings-status");
  const selectedChoice = roomChoiceSelect.value;

  if (!selectedChoice.startsWith("room:")) {
    settingsStatus.textContent = "Choose a saved room to remove.";
    return;
  }

  const roomIdToRemove = selectedChoice.replace("room:", "");

  await removeRoomFromHistory(roomIdToRemove);

  if (currentRoomId === roomIdToRemove) {
    await useLocalTimer(panel);
    settingsStatus.textContent = `Removed ${roomIdToRemove} from recent rooms. Using local timer.`;
  } else {
    await renderRoomChoices(panel);
    settingsStatus.textContent = `Removed ${roomIdToRemove} from recent rooms.`;
  }
});

roomChoiceSelect.addEventListener("change", () => {
  const selectedChoice = roomChoiceSelect.value;

  if (selectedChoice === "local") {
    roomCodeInput.value = "";
    return;
  }

  if (selectedChoice === "create-new") {
    roomCodeInput.value = "";
    return;
  }

  if (selectedChoice.startsWith("room:")) {
    roomCodeInput.value = selectedChoice.replace("room:", "");
  }
});

savePresetsBtn.addEventListener("click", async () => {
  const settingsStatus = panel.querySelector("#settings-status");

  if (timerIsRunning || timerIsPaused) {
    settingsStatus.textContent = "Stop the timer before changing presets.";
    return;
  }

  const result = collectPresetSettings(panel);

  if (result.error) {
    settingsStatus.textContent = result.error;
    return;
  }

  await savePresets(result.presets);
  renderPresetButtons(panel);

  settingsStatus.textContent = "";

  selectedSeconds = null;
  secondsLeft = 0;

  clearCustomInputs(panel);
  updateReadyState(panel, "Presets saved");
  closeSettings(panel);
});

    cancelSettingsBtn.addEventListener("click", () => {
      closeSettings(panel);
    });

    presetButtons.forEach((button) => {
      button.addEventListener("click", () => {
        chooseTime(panel, Number(button.dataset.seconds), `Ready: ${button.textContent}`);
      });
    });

    customMinutesInput.addEventListener("input", () => {
      updateCustomTimeFromInputs(panel);
    });

    customSecondsInput.addEventListener("input", () => {
      updateCustomTimeFromInputs(panel);
    });

    customMinutesInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        startBtn.focus();
      }
    });

    customSecondsInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        startBtn.focus();
      }
    });

    startBtn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !startBtn.disabled) {
        event.preventDefault();
        startOrResumeTimer(panel);
      }
    });

    startBtn.addEventListener("click", () => {
      startOrResumeTimer(panel);
    });

    pauseBtn.addEventListener("click", () => {
      pauseTimer(panel);
    });

    stopBtn.addEventListener("click", () => {
      stopTimer(panel);
    });
  }

  async function createTimerPanel() {
    let panel = document.getElementById("coteach-timer-panel");

    if (panel) {
      panel.style.display = "block";
      return panel;
    }

    await loadPresets();

    panel = document.createElement("div");
    panel.id = "coteach-timer-panel";

    panel.innerHTML = `
      <div id="coteach-header">
        <div id="coteach-title-area">
          <div id="coteach-title">123... Poof</div>
          <div id="coteach-room-status"></div>
        </div>

        <div id="coteach-header-buttons">
          <button id="coteach-settings-btn" title="Timer settings">⚙</button>
          <button id="coteach-close-btn" title="Close timer">×</button>
        </div>
      </div>

      <div id="coteach-timer-view">
        <div id="coteach-display">
          <div id="coteach-time">00:00</div>
          <div id="coteach-label">Choose a time</div>
        </div>

        <div id="coteach-expanded-controls">
          <div id="coteach-preset-buttons">
            <button class="preset-btn" data-seconds="60">1 min</button>
            <button class="preset-btn" data-seconds="180">3 min</button>
            <button class="preset-btn" data-seconds="300">5 min</button>
            <button class="preset-btn" data-seconds="600">10 min</button>
          </div>

          <div id="coteach-custom-time">
            <input id="custom-minutes" type="number" min="0" max="1440" placeholder="Min">
            <input id="custom-seconds" type="number" min="0" max="59" placeholder="Sec">
          </div>
        </div>

        <div id="coteach-main-controls">
          <button id="start-btn" disabled>Start</button>
          <button id="pause-btn" class="hidden">Pause</button>
          <button id="stop-btn">Stop</button>
        </div>
      </div>

      <div id="coteach-settings-view" class="hidden">
        <div id="settings-title">Preset Settings</div>
        <p id="settings-help">Change the preset buttons below.</p>

        <div class="preset-setting-row">
          <label>Preset 1</label>
          <input id="preset-1-minutes" type="number" min="0" max="1440" placeholder="Min">
          <input id="preset-1-seconds" type="number" min="0" max="59" placeholder="Sec">
        </div>

        <div class="preset-setting-row">
          <label>Preset 2</label>
          <input id="preset-2-minutes" type="number" min="0" max="1440" placeholder="Min">
          <input id="preset-2-seconds" type="number" min="0" max="59" placeholder="Sec">
        </div>

        <div class="preset-setting-row">
          <label>Preset 3</label>
          <input id="preset-3-minutes" type="number" min="0" max="1440" placeholder="Min">
          <input id="preset-3-seconds" type="number" min="0" max="59" placeholder="Sec">
        </div>

        <div class="preset-setting-row">
          <label>Preset 4</label>
          <input id="preset-4-minutes" type="number" min="0" max="1440" placeholder="Min">
          <input id="preset-4-seconds" type="number" min="0" max="59" placeholder="Sec">
        </div>

      <div id="room-settings-section">
        <div id="room-settings-title">Timer Room</div>
        <p id="room-settings-help">Type a room name to create it, or enter an existing code to join. Be specific when creating and naming a new room. Example: Ms. Felicia and Ms. Kay - Small Groups</p>

        <select id="room-choice-select">
          <option value="local">Local timer only</option>
          <option value="create-new">Create a new room</option>
        </select>

        <input id="room-code-input" type="text" placeholder="Or type a room code to join">

        <div id="room-buttons">
        <button id="remove-saved-room-btn">Forget</button>
        <button id="create-room-btn">Create</button>
        <button id="local-room-btn">Local</button>
      </div>

      <button id="apply-room-btn">Join Selected Room</button>
      </div>

      <p id="settings-status"></p>

      <div id="settings-buttons">
        <button id="save-presets-btn">Save Presets</button>
        <button id="cancel-settings-btn">Close</button>
      </div>
      </div>
    `;

    document.body.appendChild(panel);

    restorePanelPosition(panel);
    renderPresetButtons(panel);
    wireUpPanelEvents(panel);
    makePanelDraggable(panel);
    updateReadyState(panel);
    await renderRoomChoices(panel);

const savedRoom = await loadCurrentRoom();

if (savedRoom) {
  const connected = await connectToRoom(panel, savedRoom, { createIfMissing: false });

  if (!connected) {
    await useLocalTimer(panel);
  }
} else if (window.COTEACH_TIMER_ROOM_ID) {
  await connectToRoom(panel, window.COTEACH_TIMER_ROOM_ID, { createIfMissing: true });
} else {
  await useLocalTimer(panel);
}

    return panel;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SHOW_TIMER_PANEL") {
      createTimerPanel();
      sendResponse({ success: true });
    }
  });
}