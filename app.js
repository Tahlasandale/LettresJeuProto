/* ==========================================================================
   NÉOLOGIX - GAME ENGINE (app.js)
   Vanilla JS - Logic, State Management, WebRTC (PeerJS) & Animations
   ========================================================================== */

// --- Dictionnaire Scrabble (Points en Français) ---
const SCRABBLE_POINTS = {
    A: 1, E: 1, I: 1, O: 1, U: 1, Y: 10,
    B: 3, C: 3, D: 2, F: 4, G: 2, H: 4, J: 8, K: 10, L: 1, M: 2, N: 1, P: 3, Q: 8, R: 1, S: 1, T: 1, V: 4, W: 10, X: 10, Z: 10
};

const VOWELS = ['A', 'E', 'I', 'O', 'U', 'Y'];
const CONSONANTS = ['B', 'C', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'X', 'Z'];

// --- État Global du Jeu ---
let gameState = {
    mode: 'LOCAL',           // 'LOCAL' | 'ONLINE'
    isHost: false,           // Hôte de la partie réseau
    myPlayerId: 0,           // Mon ID joueur local (0 pour l'Hôte / J1)
    players: [],             // { id, name, score, active: true }
    roundCount: 2,           // Nombre de manches total
    currentRound: 1,         // Manche en cours (1 à roundCount)
    currentPhase: 1,         // Phase en cours (1 = Mot, 2 = Définition, 3 = Phrase)
    timerEnabled: true,      // Active/Désactive la limite de temps
    gamePhase: 'LOBBY',      // 'LOBBY'|'INPUT'|'VOTE'|'REVEAL'|'CADAVRE'|'STORY_VOTE'|'PODIUM'
    
    // Données par manche
    roundData: {},           // { roundIndex: { letters: [], word: '', wordAuthor: id, definition: '', defAuthor: id, sentence: '', sentenceAuthor: id } }
    
    // Stockage temporaire pour la phase en cours
    propositions: [],        // { playerId, text }
    votes: [],               // { voterId, targetId }
    
    // Index pour le Pass-and-play local
    activePlayerIndex: 0,    // Qui est en train d'écrire en local
    activeVoterIndex: 0,     // Qui est en train de voter en local
    
    // Mort Subite (Gestion des égalités)
    mortSubiteTies: null,    // Array de playerIds si égalité active
    isMortSubite: false,     // Flag de revote actif
    mortSubiteCount: 0,      // Compteur de revotes
    
    // Cadavre Exquis
    cadavreSentences: [],    // { playerId, text, usedWord }
    cadavreVotes: [],        // { voterId, targetId }
    activeCadavreIndex: 0,   // Joueur en train de rédiger (local ou réseau)
    winningWordsList: [],    // Liste des mots gagnants à utiliser
};

// --- Variables Réseau & PeerJS ---
let peer = null;
let connections = new Map(); // Map de { playerId: DataConnection } (Hôte seulement)
let myConnection = null;     // Liaison avec l'hôte (Client seulement)
let onlineRole = 'HOST';     // 'HOST' | 'CLIENT'
let currentStoryVoterIdx = 0;

// --- Variables Système ---
let timerInterval = null;
let timerSecondsRemaining = 0;
let stopConfettiFn = null;

// --- Éléments du DOM ---
const screens = {
    lobby: document.getElementById('screen-lobby'),
    transition: document.getElementById('screen-transition'),
    saisie: document.getElementById('screen-saisie'),
    voteTransition: document.getElementById('screen-vote-transition'),
    vote: document.getElementById('screen-vote'),
    reveal: document.getElementById('screen-reveal'),
    cadavreExquis: document.getElementById('screen-cadavre-exquis'),
    cadavreReveal: document.getElementById('screen-cadavre-reveal'),
    podium: document.getElementById('screen-podium')
};

// --- Initialisation ---
document.addEventListener('DOMContentLoaded', () => {
    toggleTimerSettings(); // Initialise l'affichage du timer local
});

// --- Gestion des Onglets du Lobby ---

function selectLobbyMode(mode) {
    gameState.mode = mode;
    
    // Mettre à jour les boutons d'onglets
    document.getElementById('tab-btn-local').classList.toggle('active', mode === 'LOCAL');
    document.getElementById('tab-btn-online').classList.toggle('active', mode === 'ONLINE');
    
    // Afficher la section correspondante
    document.getElementById('lobby-local-section').classList.toggle('hidden', mode !== 'LOCAL');
    document.getElementById('lobby-online-section').classList.toggle('hidden', mode !== 'ONLINE');
    
    // Reset les peers si on change
    cleanupNetwork();
}

function selectOnlineRole(role) {
    onlineRole = role;
    
    // Onglets de rôle en ligne
    document.getElementById('subtab-btn-host').classList.toggle('active', role === 'HOST');
    document.getElementById('subtab-btn-client').classList.toggle('active', role === 'CLIENT');
    
    // Formulaires
    document.getElementById('online-host-setup').classList.toggle('hidden', role !== 'HOST');
    document.getElementById('online-client-setup').classList.toggle('hidden', role !== 'CLIENT');
    document.getElementById('online-lobby-room').classList.add('hidden'); // masquer le salon actif
    
    cleanupNetwork();
}

function adjustRounds(amount) {
    const roundInput = document.getElementById('round-count');
    let val = parseInt(roundInput.value) + amount;
    if (val >= 1 && val <= 5) {
        roundInput.value = val;
        gameState.roundCount = val;
    }
}

function adjustOnlineRounds(amount) {
    const roundInput = document.getElementById('online-round-count');
    let val = parseInt(roundInput.value) + amount;
    if (val >= 1 && val <= 5) {
        roundInput.value = val;
        gameState.roundCount = val;
    }
}

function toggleTimerSettings() {
    const timerToggle = document.getElementById('timer-toggle');
    const timerStatus = document.getElementById('timer-status-text');
    gameState.timerEnabled = timerToggle.checked;
    
    if (gameState.timerEnabled) {
        timerStatus.textContent = "Actif (30s / 90s)";
        timerStatus.style.color = "var(--color-primary)";
    } else {
        timerStatus.textContent = "Désactivé (Pas de limite)";
        timerStatus.style.color = "var(--text-muted)";
    }
}

function toggleOnlineTimerSettings() {
    const timerToggle = document.getElementById('online-timer-toggle');
    const timerStatus = document.getElementById('online-timer-status-text');
    gameState.timerEnabled = timerToggle.checked;
    
    if (gameState.timerEnabled) {
        timerStatus.textContent = "Actif (30s / 90s)";
        timerStatus.style.color = "var(--color-primary)";
    } else {
        timerStatus.textContent = "Désactivé (Pas de limite)";
        timerStatus.style.color = "var(--text-muted)";
    }
}

// --- Gestion des Joueurs (Local) ---

function addPlayerField() {
    const container = document.getElementById('players-list-input');
    const currentCount = container.children.length;
    
    if (currentCount >= 4) {
        alert("Maximum 4 joueurs pour ce prototype.");
        return;
    }
    
    const row = document.createElement('div');
    row.className = 'player-input-row';
    row.innerHTML = `
        <span class="player-num">J${currentCount + 1}</span>
        <input type="text" class="player-name-input" placeholder="Pseudo Joueur ${currentCount + 1}">
        <button type="button" class="btn-remove" onclick="removePlayerField(this)">×</button>
    `;
    container.appendChild(row);
    
    if (container.children.length === 4) {
        document.getElementById('btn-add-player').style.display = 'none';
    }
}

function removePlayerField(button) {
    const row = button.parentElement;
    const container = document.getElementById('players-list-input');
    row.remove();
    
    Array.from(container.children).forEach((child, index) => {
        child.querySelector('.player-num').textContent = `J${index + 1}`;
    });
    
    if (container.children.length < 4) {
        document.getElementById('btn-add-player').style.display = 'inline-flex';
    }
}

// --- Nettoyage Réseau ---

function cleanupNetwork() {
    if (peer) {
        peer.destroy();
        peer = null;
    }
    connections.clear();
    myConnection = null;
    document.getElementById('btn-start-online-game').disabled = true;
}

// ==========================================================================
// 🔌 COUCHE RÉSEAU (WebRTC avec PeerJS)
// ==========================================================================

function generatePeerId() {
    // ID court et lisible (neo-xxxx)
    return 'neo-' + Math.floor(1000 + Math.random() * 9000);
}

// --- HÔTE : Créer un salon ---

function createOnlineGame() {
    cleanupNetwork();
    
    const hostName = document.getElementById('online-host-name').value.trim();
    if (hostName === "") {
        alert("Veuillez saisir un pseudo.");
        return;
    }
    
    gameState.isHost = true;
    gameState.myPlayerId = 0;
    gameState.players = [{ id: 0, name: hostName, score: 0, active: true }];
    
    document.getElementById('online-lobby-status-msg').textContent = "Connexion au serveur PeerJS...";
    
    // Tenter de créer une connexion avec un ID court
    const requestedId = generatePeerId();
    peer = new Peer(requestedId);
    
    peer.on('open', (id) => {
        setupHostLobbyUI(id);
    });
    
    peer.on('connection', (conn) => {
        handleIncomingConnection(conn);
    });
    
    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'unavailable-id') {
            // Collision d'ID, on réessaie avec un autre
            createOnlineGame();
        } else {
            alert(`Erreur réseau : ${err.message}`);
            cleanupNetwork();
            selectLobbyMode('ONLINE');
        }
    });
}

function setupHostLobbyUI(id) {
    document.getElementById('online-host-setup').classList.add('hidden');
    document.getElementById('online-lobby-room').classList.remove('hidden');
    document.getElementById('lobby-room-code').textContent = id.toUpperCase();
    document.getElementById('online-lobby-status-msg').textContent = "En attente de joueurs (min. 2)...";
    updateOnlinePlayersDisplay();
}

function handleIncomingConnection(conn) {
    conn.on('open', () => {
        // En attente du message JOIN du client
        conn.on('data', (data) => {
            if (data.type === 'JOIN') {
                registerNewPlayer(conn, data.name);
            } else {
                handleHostIncomingMessage(data, conn.metadata.playerId);
            }
        });
    });
    
    conn.on('close', () => {
        if (conn.metadata && conn.metadata.playerId !== undefined) {
            handlePlayerDisconnect(conn.metadata.playerId);
        }
    });
}

function registerNewPlayer(conn, name) {
    if (gameState.players.length >= 4) {
        conn.send({ type: 'KICK', reason: 'Le salon est complet (max 4 joueurs).' });
        conn.close();
        return;
    }
    
    // Pseudo unique
    let finalName = name.trim();
    if (gameState.players.some(p => p.name.toLowerCase() === finalName.toLowerCase())) {
        finalName += `_${gameState.players.length}`;
    }
    
    const newId = gameState.players.length;
    conn.metadata = { playerId: newId, playerName: finalName }; // Rattacher l'ID à la connexion
    connections.set(newId, conn);
    
    gameState.players.push({
        id: newId,
        name: finalName,
        score: 0,
        active: true
    });
    
    // Notifier le joueur connecté de ses infos
    conn.send({
        type: 'WELCOME',
        playerId: newId,
        players: gameState.players,
        code: peer.id.toUpperCase(),
        roundCount: gameState.roundCount,
        timerEnabled: gameState.timerEnabled
    });
    
    // Mettre à jour tout le monde
    broadcastState();
    updateOnlinePlayersDisplay();
}

function broadcastState() {
    sendToAll({
        type: 'LOBBY_UPDATE',
        players: gameState.players
    });
}

function sendToAll(data) {
    connections.forEach((conn) => {
        if (conn.open) {
            conn.send(data);
        }
    });
}

function updateOnlinePlayersDisplay() {
    const rack = document.getElementById('online-players-list-display');
    rack.innerHTML = "";
    
    gameState.players.forEach((p) => {
        const card = document.createElement('div');
        card.className = `online-player-card ${p.id === 0 ? 'host-card' : 'client-card'}`;
        card.textContent = p.name;
        rack.appendChild(card);
    });
    
    // Le bouton de lancement pour l'Hôte
    const btnStart = document.getElementById('btn-start-online-game');
    if (gameState.isHost) {
        btnStart.style.display = 'inline-flex';
        // Actif si >= 2 joueurs connectés (donc au moins 2 joueurs au total)
        btnStart.disabled = gameState.players.length < 2;
    } else {
        btnStart.style.display = 'none';
    }
}

// --- CLIENT : Rejoindre une partie ---

function joinOnlineGame() {
    cleanupNetwork();
    
    const clientName = document.getElementById('online-client-name').value.trim();
    const rawCode = document.getElementById('online-game-code').value.trim();
    
    if (clientName === "" || rawCode === "") {
        alert("Veuillez remplir votre pseudo et le code du salon.");
        return;
    }
    
    const hostId = rawCode.toLowerCase();
    gameState.isHost = false;
    
    document.getElementById('online-lobby-status-msg').textContent = "Recherche du salon...";
    document.getElementById('online-client-setup').classList.add('hidden');
    document.getElementById('online-lobby-room').classList.remove('hidden');
    document.getElementById('lobby-room-code').textContent = hostId.toUpperCase();
    
    peer = new Peer(); // ID aléatoire pour le client
    
    peer.on('open', () => {
        myConnection = peer.connect(hostId);
        
        myConnection.on('open', () => {
            document.getElementById('online-lobby-status-msg').textContent = "Connexion établie, enregistrement pseudo...";
            myConnection.send({
                type: 'JOIN',
                name: clientName
            });
        });
        
        myConnection.on('data', (data) => {
            handleClientIncomingMessage(data);
        });
        
        myConnection.on('close', () => {
            alert("⚠️ Liaison coupée avec l'Hôte. Retour au Lobby.");
            resetGame();
        });
    });
    
    peer.on('error', (err) => {
        console.error(err);
        alert("Impossible de rejoindre ce salon. Vérifiez le code.");
        resetGame();
    });
}

// --- Traitement des messages entrant (HÔTE) ---

function handleHostIncomingMessage(data, playerId) {
    if (gameState.gamePhase === 'INPUT') {
        if (data.type === 'SUBMIT_PROPOSITION') {
            registerOnlineProposition(playerId, data.text);
        }
    } else if (gameState.gamePhase === 'VOTE') {
        if (data.type === 'SUBMIT_VOTE') {
            registerOnlineVote(playerId, data.targetId);
        }
    } else if (gameState.gamePhase === 'CADAVRE') {
        if (data.type === 'SUBMIT_CADAVRE') {
            registerOnlineCadavre(playerId, data.text, data.usedWord);
        }
    } else if (gameState.gamePhase === 'STORY_VOTE') {
        if (data.type === 'SUBMIT_STORY_VOTE') {
            registerOnlineStoryVote(playerId, data.targetId);
        }
    }
}

// --- Traitement des messages entrant (CLIENT) ---

function handleClientIncomingMessage(data) {
    switch (data.type) {
        case 'WELCOME':
            gameState.myPlayerId = data.playerId;
            gameState.players = data.players;
            gameState.roundCount = data.roundCount;
            gameState.timerEnabled = data.timerEnabled;
            document.getElementById('lobby-room-code').textContent = data.code;
            document.getElementById('online-lobby-status-msg').textContent = "En attente du lancement par l'Hôte...";
            updateOnlinePlayersDisplay();
            break;
            
        case 'LOBBY_UPDATE':
            gameState.players = data.players;
            updateOnlinePlayersDisplay();
            break;
            
        case 'KICK':
            alert(`Exclu : ${data.reason}`);
            resetGame();
            break;
            
        case 'GAME_START':
            // Lancement du jeu
            document.getElementById('global-header').classList.remove('hidden');
            showScreen('saisie'); // Sera configuré par PHASE_START immédiatement
            break;
            
        case 'PHASE_START':
            gameState.currentRound = data.round;
            gameState.currentPhase = data.phase;
            gameState.gamePhase = 'INPUT';
            updateGlobalHeader();
            
            // Stocker temporairement pour affichage locale
            gameState.roundData[data.round] = gameState.roundData[data.round] || {};
            if (data.letters) gameState.roundData[data.round].letters = data.letters;
            if (data.word) gameState.roundData[data.round].word = data.word;
            if (data.definition) gameState.roundData[data.round].definition = data.definition;
            
            showScreen('saisie');
            setupClientSaisieUI(data.duration);
            break;
            
        case 'TIMER_TICK':
            syncClientTimer(data.seconds, data.total);
            break;
            
        case 'VOTE_START':
            gameState.gamePhase = 'VOTE';
            gameState.voteOptions = data.propositions;
            gameState.isMortSubite = data.isMortSubite;
            
            showScreen('vote');
            setupClientVoteUI();
            break;
            
        case 'REVEAL_WINNER':
            gameState.gamePhase = 'REVEAL';
            if (stopConfettiFn) stopConfettiFn();
            
            // Mettre à jour les scores reçus
            gameState.players = data.scoreboard;
            
            showScreen('reveal');
            document.getElementById('reveal-winning-text').textContent = data.text;
            document.getElementById('reveal-winner-author').textContent = data.authorName;
            document.getElementById('reveal-points-added').textContent = data.points;
            
            renderScoreboard();
            
            // Désactiver le bouton continuer pour les clients (seul le Host continue)
            const btnNext = document.querySelector('#screen-reveal .scoreboard-panel .btn-primary');
            btnNext.style.display = 'none';
            
            stopConfettiFn = startConfetti('confetti-canvas');
            break;
            
        case 'CADAVRE_START':
            gameState.gamePhase = 'CADAVRE';
            gameState.winningWordsList = data.winningWords;
            document.getElementById('global-header').classList.add('hidden');
            
            showScreen('cadavreExquis');
            setupClientCadavreUI(data.peekText, data.duration);
            break;
            
        case 'CADAVRE_WAIT':
            gameState.gamePhase = 'CADAVRE';
            document.getElementById('global-header').classList.add('hidden');
            showScreen('cadavreExquis');
            setupClientCadavreWaitUI(data.writerName);
            break;
            
        case 'STORY_REVEAL':
            gameState.gamePhase = 'STORY_VOTE';
            gameState.cadavreSentences = data.sentences;
            gameState.cadavreVotes = [];
            currentStoryVoterIdx = 0;
            
            showScreen('cadavreReveal');
            renderOnlineStoryText(data.sentences, data.definitionsMap);
            renderOnlineStoryVoteArea(data.activePlayers);
            break;
            
        case 'STORY_VOTE_TICK':
            currentStoryVoterIdx = data.currentVoterIdx;
            updateOnlineStoryVoteStatus(data.currentVoterName, data.activePlayers, data.timeRemaining);
            break;
            
        case 'GAME_OVER':
            gameState.gamePhase = 'PODIUM';
            gameState.players = data.podium;
            showScreen('podium');
            showFinalPodium();
            break;
            
        case 'PLAYER_DISCONNECT':
            alert(`🔌 ${data.name} a quitté la partie.`);
            gameState.players = data.players;
            renderScoreboard();
            break;
    }
}

// --- Gestion des Déconnexions en cours de partie ---

function handlePlayerDisconnect(playerId) {
    const p = gameState.players.find(pl => pl.id === playerId);
    if (!p) return;
    
    p.active = false;
    connections.delete(playerId);
    
    // Si la partie est encore au salon (LOBBY), on retire complètement le joueur
    if (gameState.gamePhase === 'LOBBY') {
        // Re-mapper le tableau de joueurs restants (l'Hôte reste id 0)
        const activeClients = Array.from(connections.values());
        gameState.players = [{ id: 0, name: gameState.players[0].name, score: 0, active: true }];
        
        connections.clear();
        activeClients.forEach((conn, index) => {
            const newId = index + 1;
            conn.metadata = { playerId: newId, playerName: conn.metadata.playerName };
            connections.set(newId, conn);
            gameState.players.push({
                id: newId,
                name: conn.metadata.playerName || `Joueur ${newId + 1}`,
                score: 0,
                active: true
            });
            // Envoyer la mise à jour de l'ID au client
            conn.send({
                type: 'WELCOME',
                playerId: newId,
                players: gameState.players,
                code: peer.id.toUpperCase(),
                roundCount: gameState.roundCount,
                timerEnabled: gameState.timerEnabled
            });
        });
        
        broadcastState();
        updateOnlinePlayersDisplay();
    } else {
        // En partie
        // Diffuser la déconnexion
        sendToAll({
            type: 'PLAYER_DISCONNECT',
            name: p.name,
            players: gameState.players
        });
        
        if (!checkActivePlayersCount()) return;
        
        // Vérifier si cela débloque une attente
        if (gameState.gamePhase === 'INPUT') {
            checkAllInputsSubmitted();
        } else if (gameState.gamePhase === 'VOTE') {
            checkAllVotesSubmitted();
        } else if (gameState.gamePhase === 'CADAVRE') {
            checkAllCadavreSubmitted();
        } else if (gameState.gamePhase === 'STORY_VOTE') {
            checkAllStoryVotesSubmitted();
        }
    }
}

function checkAllCadavreSubmitted() {
    if (gameState.gamePhase !== 'CADAVRE') return;
    const activePlayers = getActivePlayers();
    if (gameState.activeCadavreIndex >= activePlayers.length) {
        initOnlineCadavreReveal();
    } else {
        triggerNextOnlineCadavreTurn();
    }
}

function checkAllStoryVotesSubmitted() {
    if (gameState.gamePhase !== 'STORY_VOTE') return;
    const activePlayers = getActivePlayers();
    if (currentStoryVoterIdx >= activePlayers.length) {
        tallyCadavreVotes();
    } else {
        sendToAll({
            type: 'STORY_VOTE_TICK',
            currentVoterIdx: currentStoryVoterIdx,
            activePlayers: activePlayers
        });
        renderOnlineStoryVoteArea(activePlayers);
    }
}

function renderScoreboard() {
    const list = document.getElementById('scoreboard-list');
    if (!list) return;
    list.innerHTML = "";
    
    const sorted = [...gameState.players].sort((a, b) => {
        if (!a.active && b.active) return 1;
        if (a.active && !b.active) return -1;
        return b.score - a.score;
    });
    
    sorted.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = `score-row ${!p.active ? 'cursed' : ''}`;
        row.innerHTML = `
            <div class="score-player-name">
                <span class="score-player-rank">${idx + 1}</span>
                ${escapeHTML(p.name)}
            </div>
            <div class="score-player-val">${p.score} pts</div>
        `;
        list.appendChild(row);
    });
}

function escapeHTML(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ==========================================================================
// 🎮 LOGIQUE DE JEU PRINCIPALE
// ==========================================================================

function startOnlineGame() {
    if (!gameState.isHost) return;
    
    gameState.mode = 'ONLINE';
    
    // Notifier tout le monde
    sendToAll({ type: 'GAME_START' });
    
    // Masquer le lobby et lancer la manche 1
    document.getElementById('global-header').classList.remove('hidden');
    
    gameState.currentRound = 1;
    gameState.currentPhase = 1;
    gameState.roundData = {};
    gameState.winningWordsList = [];
    
    startNewRound();
}

function startGame() {
    // Lancement LOCAL classique
    gameState.mode = 'LOCAL';
    gameState.isHost = false;
    
    const nameInputs = document.querySelectorAll('.player-name-input');
    const players = [];
    
    let validCount = 0;
    nameInputs.forEach((input, index) => {
        let name = input.value.trim();
        if (name === "") {
            name = `Joueur ${index + 1}`;
        }
        players.push({
            id: index,
            name: name,
            score: 0,
            active: true
        });
        validCount++;
    });
    
    if (validCount < 2) {
        alert("Il faut au moins 2 joueurs pour jouer.");
        return;
    }
    
    gameState.players = players;
    gameState.currentRound = 1;
    gameState.currentPhase = 1;
    gameState.roundData = {};
    gameState.winningWordsList = [];
    
    // Afficher le header
    document.getElementById('global-header').classList.remove('hidden');
    
    // Lancer la première manche
    startNewRound();
}

// --- Début de Manche ---

function startNewRound() {
    const round = gameState.currentRound;
    gameState.currentPhase = 1;
    
    // Générer le tirage
    const letters = generateLetters();
    gameState.roundData[round] = {
        letters: letters,
        word: '',
        wordAuthor: null,
        definition: '',
        defAuthor: null,
        sentence: '',
        sentenceAuthor: null
    };
    
    initSaisiePhase();
}

// --- Phase de Saisie ---

function initSaisiePhase() {
    gameState.gamePhase = 'INPUT';
    gameState.propositions = [];
    gameState.activePlayerIndex = 0;
    
    if (!checkActivePlayersCount()) return;
    
    if (gameState.mode === 'LOCAL') {
        showTransitionScreenForInput();
    } else {
        // En ligne : tout le monde joue en même temps
        const duration = (gameState.currentPhase === 1) ? 30 : 90;
        const round = gameState.currentRound;
        const phase = gameState.currentPhase;
        
        // Diffuser aux clients
        sendToAll({
            type: 'PHASE_START',
            round: round,
            phase: phase,
            duration: duration,
            letters: phase === 1 ? gameState.roundData[round].letters : null,
            word: phase > 1 ? gameState.roundData[round].word : null,
            definition: phase > 2 ? gameState.roundData[round].definition : null
        });
        
        // Configurer l'hôte localement
        showScreen('saisie');
        setupOnlineHostSaisieUI(duration);
    }
}

// --- Configuration des UIs de Saisie Réseau ---

function setupOnlineHostSaisieUI(duration) {
    const round = gameState.currentRound;
    const phase = gameState.currentPhase;
    
    // Similaire à la saisie locale mais pas d'index de joueur
    const promptTitle = document.getElementById('saisie-prompt-title');
    const contextArea = document.getElementById('saisie-context-area');
    const helperText = document.getElementById('saisie-helper-text');
    const inputLabel = document.getElementById('saisie-input-label');
    const inputField = document.getElementById('saisie-input');
    
    inputField.disabled = false;
    inputField.value = "";
    document.getElementById('saisie-progress').style.width = "0%";
    
    if (phase === 1) {
        promptTitle.textContent = "Invente ton mot !";
        inputLabel.textContent = "Néologisme";
        inputField.placeholder = "Tape ton mot inventé...";
        helperText.textContent = "Utilise les lettres ci-dessus.";
        
        const letters = gameState.roundData[round].letters;
        let html = '<div class="letters-rack">';
        letters.forEach((l, idx) => {
            const pts = SCRABBLE_POINTS[l] || 1;
            html += `<div class="letter-block" style="animation-delay: ${idx * 0.08}s">${l}<span class="letter-score">${pts}</span></div>`;
        });
        html += '</div>';
        contextArea.innerHTML = html;
    } else if (phase === 2) {
        const officialWord = gameState.roundData[round].word;
        promptTitle.textContent = "Trouve une définition !";
        inputLabel.textContent = "Définition";
        inputField.placeholder = "Selon toi, que veut dire ce mot...";
        helperText.textContent = `Donne un sens au mot officiel : "${officialWord}"`;
        contextArea.innerHTML = `<div class="word-pill">${officialWord}</div>`;
    } else if (phase === 3) {
        const officialWord = gameState.roundData[round].word;
        const officialDef = gameState.roundData[round].definition;
        promptTitle.textContent = "Fais une phrase !";
        inputLabel.textContent = "Exemple de phrase";
        inputField.placeholder = "Tape ta phrase d'exemple...";
        helperText.textContent = `Utilise obligatoirement le mot "${officialWord}" dans ta phrase.`;
        contextArea.innerHTML = `
            <div class="word-pill">${officialWord}</div>
            <p style="margin-top: 10px; font-style: italic; color: var(--text-main);">"${officialDef}"</p>
        `;
    }
    
    document.getElementById('btn-submit-saisie').disabled = false;
    document.getElementById('btn-submit-saisie').onclick = submitOnlineHostSaisie;
    
    setTimeout(() => inputField.focus(), 100);
    
    // Chronomètre unique géré par l'Hôte
    startOnlineTimer(duration);
}

function setupClientSaisieUI(duration) {
    const round = gameState.currentRound;
    const phase = gameState.currentPhase;
    
    const promptTitle = document.getElementById('saisie-prompt-title');
    const contextArea = document.getElementById('saisie-context-area');
    const helperText = document.getElementById('saisie-helper-text');
    const inputLabel = document.getElementById('saisie-input-label');
    const inputField = document.getElementById('saisie-input');
    
    inputField.disabled = false;
    inputField.value = "";
    document.getElementById('saisie-progress').style.width = "0%";
    
    if (phase === 1) {
        promptTitle.textContent = "Invente ton mot !";
        inputLabel.textContent = "Néologisme";
        inputField.placeholder = "Tape ton mot...";
        helperText.textContent = "Utilise les lettres ci-dessus.";
        
        const letters = gameState.roundData[round].letters;
        let html = '<div class="letters-rack">';
        letters.forEach((l, idx) => {
            const pts = SCRABBLE_POINTS[l] || 1;
            html += `<div class="letter-block" style="animation-delay: ${idx * 0.08}s">${l}<span class="letter-score">${pts}</span></div>`;
        });
        html += '</div>';
        contextArea.innerHTML = html;
    } else if (phase === 2) {
        const officialWord = gameState.roundData[round].word;
        promptTitle.textContent = "Trouve une définition !";
        inputLabel.textContent = "Définition";
        inputField.placeholder = "Que veut dire ce mot...";
        helperText.textContent = `Donne un sens au mot officiel : "${officialWord}"`;
        contextArea.innerHTML = `<div class="word-pill">${officialWord}</div>`;
    } else if (phase === 3) {
        const officialWord = gameState.roundData[round].word;
        const officialDef = gameState.roundData[round].definition;
        promptTitle.textContent = "Fais une phrase !";
        inputLabel.textContent = "Exemple de phrase";
        inputField.placeholder = "Tape ta phrase d'exemple...";
        helperText.textContent = `Utilise obligatoirement le mot "${officialWord}" dans ta phrase.`;
        contextArea.innerHTML = `
            <div class="word-pill">${officialWord}</div>
            <p style="margin-top: 10px; font-style: italic; color: var(--text-main);">"${officialDef}"</p>
        `;
    }
    
    document.getElementById('btn-submit-saisie').disabled = false;
    document.getElementById('btn-submit-saisie').onclick = submitClientSaisie;
    
    // Le client démarre un timer fictif qui sera synchronisé par l'Hôte
    startClientTimer(duration);
    
    setTimeout(() => inputField.focus(), 100);
}

// --- Soumissions en Ligne ---

function submitOnlineHostSaisie() {
    const inputField = document.getElementById('saisie-input');
    const val = inputField.value.trim();
    
    if (!validateSaisieInputLocal(val)) return;
    
    // Enregistrer localement
    gameState.propositions.push({
        playerId: 0, // Hôte
        text: val
    });
    
    // Désactiver le champ
    inputField.disabled = true;
    document.getElementById('btn-submit-saisie').disabled = true;
    document.getElementById('saisie-prompt-title').textContent = "Proposition validée !";
    document.getElementById('saisie-helper-text').textContent = "En attente des autres joueurs...";
    
    // Vérifier si tout le monde a répondu
    checkAllInputsSubmitted();
}

function submitClientSaisie() {
    const inputField = document.getElementById('saisie-input');
    const val = inputField.value.trim();
    
    if (val === "") {
        alert("Saisie vide !");
        return;
    }
    
    if (gameState.currentPhase === 1) {
        if (!/^[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÇœŒæÆ-]+$/.test(val) || val.length < 2) {
            alert("Lettres et tiret uniquement (min. 2).");
            return;
        }
        // Vérification des lettres imposées du tirage côté client
        const rackCopy = [...gameState.roundData[gameState.currentRound].letters];
        const inputLetters = val.toUpperCase().split('');
        let lettersMatch = true;
        for (let char of inputLetters) {
            const index = rackCopy.indexOf(char);
            if (index === -1) {
                lettersMatch = false;
                break;
            } else {
                rackCopy.splice(index, 1);
            }
        }
        if (!lettersMatch) {
            alert(`Ton mot ne peut contenir que les lettres du tirage : ${gameState.roundData[gameState.currentRound].letters.join(', ')}`);
            return;
        }
    } else if (gameState.currentPhase === 3) {
        const officialWord = gameState.roundData[gameState.currentRound].word.toLowerCase();
        if (!val.toLowerCase().includes(officialWord)) {
            alert(`Ta phrase doit contenir le mot "${gameState.roundData[gameState.currentRound].word}" !`);
            return;
        }
    }
    
    // Envoyer à l'hôte
    myConnection.send({
        type: 'SUBMIT_PROPOSITION',
        text: val
    });
    
    inputField.disabled = true;
    document.getElementById('btn-submit-saisie').disabled = true;
    document.getElementById('saisie-prompt-title').textContent = "Proposition envoyée !";
    document.getElementById('saisie-helper-text').textContent = "En attente de l'Hôte...";
}

function registerOnlineProposition(playerId, text) {
    if (gameState.gamePhase !== 'INPUT') return;
    // Vérifier que le joueur n'a pas déjà soumis
    if (gameState.propositions.some(p => p.playerId === playerId)) return;
    
    // Valider la proposition du joueur contre les règles de la phase courante
    let isValid = true;
    if (gameState.currentPhase === 1) {
        if (!/^[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÇœŒæÆ-]+$/.test(text) || text.length < 2) {
            isValid = false;
        } else {
            const rackCopy = [...gameState.roundData[gameState.currentRound].letters];
            const inputLetters = text.toUpperCase().split('');
            for (let char of inputLetters) {
                const index = rackCopy.indexOf(char);
                if (index === -1) {
                    isValid = false;
                    break;
                } else {
                    rackCopy.splice(index, 1);
                }
            }
        }
    } else if (gameState.currentPhase === 3) {
        const officialWord = gameState.roundData[gameState.currentRound].word.toLowerCase();
        if (!text.toLowerCase().includes(officialWord)) {
            isValid = false;
        }
    }
    
    if (!isValid) {
        console.warn(`Proposition invalide reçue du joueur ${playerId}: ${text}`);
        return;
    }
    
    gameState.propositions.push({
        playerId: playerId,
        text: text
    });
    
    checkAllInputsSubmitted();
}

function checkAllInputsSubmitted() {
    if (gameState.gamePhase !== 'INPUT') return;
    const activeCount = getActivePlayers().length;
    if (gameState.propositions.length >= activeCount) {
        clearInterval(timerInterval);
        initVotePhase();
    }
}

function validateSaisieInputLocal(val) {
    if (val === "") {
        alert("Tu ne peux pas valider une proposition vide !");
        return false;
    }
    
    if (gameState.currentPhase === 1) {
        if (!/^[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÇœŒæÆ-]+$/.test(val)) {
            alert("Le mot ne doit contenir que des lettres ou un tiret.");
            return false;
        }
        if (val.length < 2) {
            alert("Le mot doit faire au moins 2 lettres.");
            return false;
        }
        
        // Vérification des lettres
        const rackCopy = [...gameState.roundData[gameState.currentRound].letters];
        const inputLetters = val.toUpperCase().split('');
        let lettersMatch = true;
        for (let char of inputLetters) {
            const index = rackCopy.indexOf(char);
            if (index === -1) {
                lettersMatch = false;
                break;
            } else {
                rackCopy.splice(index, 1);
            }
        }
        if (!lettersMatch) {
            alert(`Ton mot ne peut contenir que les lettres du tirage : ${gameState.roundData[gameState.currentRound].letters.join(', ')}`);
            return false;
        }
    }
    
    if (gameState.currentPhase === 3) {
        const officialWord = gameState.roundData[gameState.currentRound].word.toLowerCase();
        if (!val.toLowerCase().includes(officialWord)) {
            alert(`La phrase doit contenir le mot "${gameState.roundData[gameState.currentRound].word}".`);
            return false;
        }
    }
    
    return true;
}

// --- Écran de Transition (Pass & Play) ---

function showTransitionScreenForInput() {
    const activePlayers = getActivePlayers();
    if (gameState.activePlayerIndex >= activePlayers.length) {
        initVotePhase();
        return;
    }
    
    const currentPlayer = activePlayers[gameState.activePlayerIndex];
    updateGlobalHeader();
    
    document.getElementById('transition-avatar').textContent = currentPlayer.name.charAt(0).toUpperCase();
    document.getElementById('transition-title').innerHTML = `C'est au tour de <span class="highlight-name">${currentPlayer.name}</span>`;
    
    let instruction = "";
    if (gameState.currentPhase === 1) {
        instruction = "Prépare-toi à inventer un mot avec les lettres tirées !";
    } else if (gameState.currentPhase === 2) {
        instruction = `Prépare-toi à définir le mot officiel : "${gameState.roundData[gameState.currentRound].word}"`;
    } else if (gameState.currentPhase === 3) {
        instruction = `Mets en scène le mot et sa définition dans une phrase originale !`;
    }
    document.getElementById('transition-instruction').textContent = instruction;
    
    // Rétablir le clic standard
    document.querySelector('#screen-transition .btn-primary').onclick = proceedToSaisie;
    
    showScreen('transition');
}

function proceedToSaisie() {
    showScreen('saisie');
    setupLocalSaisieUI();
}

function setupLocalSaisieUI() {
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activePlayerIndex];
    const round = gameState.currentRound;
    const phase = gameState.currentPhase;
    
    const promptTitle = document.getElementById('saisie-prompt-title');
    const contextArea = document.getElementById('saisie-context-area');
    const helperText = document.getElementById('saisie-helper-text');
    const inputLabel = document.getElementById('saisie-input-label');
    const inputField = document.getElementById('saisie-input');
    
    inputField.disabled = false;
    inputField.value = "";
    
    const progressPercent = (gameState.activePlayerIndex / activePlayers.length) * 100;
    document.getElementById('saisie-progress').style.width = `${progressPercent}%`;
    
    if (phase === 1) {
        promptTitle.textContent = "Invente ton mot !";
        inputLabel.textContent = "Néologisme";
        inputField.placeholder = "Tape ton mot inventé...";
        helperText.textContent = "Utilise les lettres ci-dessus. Pas de dictionnaire, fais jouer ta mauvaise foi !";
        
        const letters = gameState.roundData[round].letters;
        let html = '<div class="letters-rack">';
        letters.forEach((l, idx) => {
            const pts = SCRABBLE_POINTS[l] || 1;
            html += `<div class="letter-block" style="animation-delay: ${idx * 0.08}s">${l}<span class="letter-score">${pts}</span></div>`;
        });
        html += '</div>';
        contextArea.innerHTML = html;
        
    } else if (phase === 2) {
        const officialWord = gameState.roundData[round].word;
        promptTitle.textContent = "Trouve une définition !";
        inputLabel.textContent = "Définition";
        inputField.placeholder = "Selon toi, que veut dire ce mot...";
        helperText.textContent = `Donne un sens convaincant ou absurde au mot officiel ci-dessus.`;
        contextArea.innerHTML = `<div class="word-pill">${officialWord}</div>`;
        
    } else if (phase === 3) {
        const officialWord = gameState.roundData[round].word;
        const officialDef = gameState.roundData[round].definition;
        promptTitle.textContent = "Fais une phrase !";
        inputLabel.textContent = "Exemple de phrase";
        inputField.placeholder = "Tape ta phrase d'exemple...";
        helperText.textContent = `Utilise obligatoirement le mot "${officialWord}" dans ta phrase.`;
        contextArea.innerHTML = `
            <div class="word-pill">${officialWord}</div>
            <p style="margin-top: 10px; font-style: italic; color: var(--text-main);">"${officialDef}"</p>
        `;
    }
    
    document.getElementById('btn-submit-saisie').disabled = false;
    document.getElementById('btn-submit-saisie').onclick = submitLocalSaisie;
    
    setTimeout(() => inputField.focus(), 100);
    
    startTimer(phase === 1 ? 30 : 90);
}

function submitLocalSaisie() {
    const inputField = document.getElementById('saisie-input');
    const val = inputField.value.trim();
    
    if (!validateSaisieInputLocal(val)) return;
    
    clearInterval(timerInterval);
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activePlayerIndex];
    
    gameState.propositions.push({
        playerId: currentPlayer.id,
        text: val
    });
    
    gameState.activePlayerIndex++;
    showTransitionScreenForInput();
}

// --- Timers Réseau (Hôte autoritaire) ---

function startOnlineTimer(duration) {
    clearInterval(timerInterval);
    const wrapper = document.querySelector('.timer-wrapper');
    const timerText = document.getElementById('timer-text');
    const timerBar = document.getElementById('timer-bar');
    
    if (!gameState.timerEnabled) {
        wrapper.style.display = 'none';
        return;
    }
    
    wrapper.style.display = 'block';
    wrapper.classList.remove('timer-hurry');
    
    timerSecondsRemaining = duration;
    timerText.textContent = timerSecondsRemaining;
    timerBar.style.strokeDashoffset = 0;
    
    // Envoyer le tick initial
    sendToAll({ type: 'TIMER_TICK', seconds: timerSecondsRemaining, total: duration });
    
    timerInterval = setInterval(() => {
        timerSecondsRemaining--;
        timerText.textContent = timerSecondsRemaining;
        
        const pct = timerSecondsRemaining / duration;
        const offset = 283 * (1 - pct);
        timerBar.style.strokeDashoffset = offset;
        
        if (timerSecondsRemaining <= 10) {
            wrapper.classList.add('timer-hurry');
        }
        
        // Envoyer la synchro
        sendToAll({ type: 'TIMER_TICK', seconds: timerSecondsRemaining, total: duration });
        
        if (timerSecondsRemaining <= 0) {
            clearInterval(timerInterval);
            handleOnlineAFKTimeout();
        }
    }, 1000);
}

function handleOnlineAFKTimeout() {
    if (gameState.gamePhase !== 'INPUT') return;
    
    // Auto-saisie de l'Hôte si non vide
    if (!gameState.propositions.some(p => p.playerId === 0)) {
        const inputField = document.getElementById('saisie-input');
        const val = inputField.value.trim();
        if (val !== "" && validateSaisieInputLocal(val)) {
            gameState.propositions.push({ playerId: 0, text: val });
        }
    }
    
    // Attendre 1.5s pour laisser le temps aux auto-soumissions réseau d'arriver
    setTimeout(() => {
        if (gameState.gamePhase !== 'INPUT') return;
        
        const activePlayers = getActivePlayers();
        
        // Traiter chaque joueur actif
        activePlayers.forEach((player) => {
            const hasSubmitted = gameState.propositions.some(p => p.playerId === player.id);
            
            if (!hasSubmitted) {
                // Disqualifier le client
                player.active = false;
                if (player.id !== 0) {
                    const conn = connections.get(player.id);
                    if (conn) {
                        conn.send({ type: 'KICK', reason: "Temps écoulé ou proposition invalide (AFK)." });
                        conn.close();
                    }
                } else {
                    alert("💀 Vous avez été éliminé pour inactivité !");
                }
            }
        });
        
        // Mettre à jour l'état de jeu
        broadcastState();
        
        if (checkActivePlayersCount()) {
            initVotePhase();
        }
    }, 1500);
}

// --- Timers Clients (Fictif synchronisé) ---

function startClientTimer(duration) {
    clearInterval(timerInterval);
    const wrapper = document.querySelector('.timer-wrapper');
    const timerText = document.getElementById('timer-text');
    const timerBar = document.getElementById('timer-bar');
    
    if (!gameState.timerEnabled) {
        wrapper.style.display = 'none';
        return;
    }
    
    wrapper.style.display = 'block';
    wrapper.classList.remove('timer-hurry');
    
    timerSecondsRemaining = duration;
    timerText.textContent = timerSecondsRemaining;
    timerBar.style.strokeDashoffset = 0;
}

function syncClientTimer(seconds, total) {
    if (gameState.gamePhase === 'CADAVRE') {
        const timerText = document.getElementById('cadavre-timer-value');
        if (timerText) {
            timerText.textContent = seconds;
        }
        if (seconds <= 0) {
            clearInterval(timerInterval);
            const textarea = document.getElementById('cadavre-textarea');
            if (!textarea.disabled && textarea.value.trim() !== "") {
                submitClientCadavre();
            }
        }
    } else {
        const timerText = document.getElementById('timer-text');
        const timerBar = document.getElementById('timer-bar');
        const wrapper = document.querySelector('.timer-wrapper');
        
        if (!wrapper) return;
        
        timerSecondsRemaining = seconds;
        timerText.textContent = seconds;
        
        const pct = seconds / total;
        const offset = 283 * (1 - pct);
        timerBar.style.strokeDashoffset = offset;
        
        if (seconds <= 10) {
            wrapper.classList.add('timer-hurry');
        } else {
            wrapper.classList.remove('timer-hurry');
        }
        
        if (seconds <= 0) {
            clearInterval(timerInterval);
            // Si le champ est non vide, tenter de soumettre automatiquement avant l'exclusion
            const inputField = document.getElementById('saisie-input');
            if (!inputField.disabled && inputField.value.trim() !== "") {
                submitClientSaisie();
            }
        }
    }
}

// --- Timers Classique Local (Pass & Play) ---

function startTimer(duration) {
    clearInterval(timerInterval);
    const wrapper = document.querySelector('.timer-wrapper');
    const timerText = document.getElementById('timer-text');
    const timerBar = document.getElementById('timer-bar');
    
    if (!gameState.timerEnabled) {
        wrapper.style.display = 'none';
        return;
    }
    
    wrapper.style.display = 'block';
    wrapper.classList.remove('timer-hurry');
    
    timerSecondsRemaining = duration;
    timerText.textContent = timerSecondsRemaining;
    timerBar.style.strokeDashoffset = 0;
    
    timerInterval = setInterval(() => {
        timerSecondsRemaining--;
        timerText.textContent = timerSecondsRemaining;
        
        const pct = timerSecondsRemaining / duration;
        const offset = 283 * (1 - pct);
        timerBar.style.strokeDashoffset = offset;
        
        if (timerSecondsRemaining <= 10) {
            wrapper.classList.add('timer-hurry');
        }
        
        if (timerSecondsRemaining <= 0) {
            clearInterval(timerInterval);
            handleAFKTimeout();
        }
    }, 1000);
}

function handleAFKTimeout() {
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activePlayerIndex];
    const inputField = document.getElementById('saisie-input');
    const val = inputField.value.trim();
    
    if (val !== "") {
        let isValid = true;
        if (gameState.currentPhase === 1) {
            if (!/^[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÇœŒæÆ-]+$/.test(val) || val.length < 2) {
                isValid = false;
            } else {
                const rackCopy = [...gameState.roundData[gameState.currentRound].letters];
                const inputLetters = val.toUpperCase().split('');
                for (let char of inputLetters) {
                    const index = rackCopy.indexOf(char);
                    if (index === -1) {
                        isValid = false;
                        break;
                    } else {
                        rackCopy.splice(index, 1);
                    }
                }
            }
        } else if (gameState.currentPhase === 3) {
            const officialWord = gameState.roundData[gameState.currentRound].word.toLowerCase();
            if (!val.toLowerCase().includes(officialWord)) {
                isValid = false;
            }
        }
        
        if (isValid) {
            gameState.propositions.push({
                playerId: currentPlayer.id,
                text: val
            });
            alert(`⏳ Temps écoulé ! La proposition en cours de ${currentPlayer.name} ("${val}") est valide et a été enregistrée automatiquement.`);
            gameState.activePlayerIndex++;
            showTransitionScreenForInput();
            return;
        }
    }
    
    currentPlayer.active = false;
    alert(`💀 MALÉDICTION ! ${currentPlayer.name} n'a pas répondu à temps ou sa proposition en cours était invalide ! Il est exclu de la partie.`);
    document.getElementById('saisie-input').value = "";
    
    const newActivePlayers = getActivePlayers();
    if (gameState.activePlayerIndex >= newActivePlayers.length) {
        gameState.activePlayerIndex = newActivePlayers.length;
    }
    
    if (checkActivePlayersCount()) {
        showTransitionScreenForInput();
    }
}

// ==========================================================================
// 🗳️ LOGIQUE DES VOTES (Local & Réseau)
// ==========================================================================

function initVotePhase() {
    gameState.gamePhase = 'VOTE';
    gameState.votes = [];
    gameState.activeVoterIndex = 0;
    
    prepareVoteOptions();
    
    if (gameState.mode === 'LOCAL') {
        showTransitionScreenForVote();
    } else {
        // Mode Réseau : Diffuser la phase de vote à tout le monde
        const activePlayers = getActivePlayers();
        
        activePlayers.forEach((player) => {
            // Anonymiser et exclure la propre carte de chaque joueur (si plus de 2 joueurs actifs)
            const clientOpts = gameState.voteOptions.map(opt => ({
                playerId: opt.playerId,
                text: opt.text,
                isOwn: activePlayers.length > 2 ? (opt.playerId === player.id) : false
            }));
            
            if (player.id !== 0) {
                const conn = connections.get(player.id);
                if (conn) {
                    conn.send({
                        type: 'VOTE_START',
                        propositions: clientOpts,
                        isMortSubite: gameState.isMortSubite
                    });
                }
            } else {
                // Configurer l'hôte localement
                gameState.clientVoteOpts = clientOpts;
                showScreen('vote');
                setupOnlineHostVoteUI();
            }
        });
        
        // Si l'Hôte est inactif, il doit voir un écran de spectateur pour ne pas figer son affichage
        if (!gameState.players[0].active) {
            showScreen('vote');
            document.getElementById('vote-prompt-title').textContent = "Mode Spectateur";
            document.getElementById('vote-voter-name').textContent = "Tu as été éliminé de la partie";
            document.getElementById('vote-cards-area').innerHTML = "<div class='info-text'>Les autres joueurs sont en train de voter...</div>";
            document.getElementById('btn-submit-vote').disabled = true;
        }
    }
}

function prepareVoteOptions() {
    let rawOptions = [];
    if (gameState.isMortSubite && gameState.mortSubiteTies) {
        rawOptions = gameState.propositions.filter(p => gameState.mortSubiteTies.includes(p.playerId));
    } else {
        rawOptions = gameState.propositions;
    }
    gameState.voteOptions = [...rawOptions].sort(() => Math.random() - 0.5);
}

// --- Saisie du Vote (Hôte en ligne) ---

function setupOnlineHostVoteUI() {
    const voterName = document.getElementById('vote-voter-name');
    const container = document.getElementById('vote-cards-area');
    const voteTitle = document.getElementById('vote-prompt-title');
    
    // Mettre à jour dynamiquement la notice d'aide
    const activePlayers = getActivePlayers();
    const infoText = document.querySelector('.vote-actions .info-text');
    if (infoText) {
        if (activePlayers.length > 2) {
            infoText.textContent = "Clique sur une carte pour la sélectionner. Tu ne peux pas voter pour ta propre proposition (elle est grisée).";
        } else {
            infoText.textContent = "Clique sur une carte pour la sélectionner. Exception : à 2 joueurs, vous pouvez voter pour votre propre proposition !";
        }
    }
    
    voterName.textContent = `Votant : Hôte`;
    container.innerHTML = "";
    
    if (gameState.isMortSubite) {
        voteTitle.innerHTML = `⚡ MORT SUBITE ⚡ Égalité ! Vote pour départager :`;
    } else {
        voteTitle.textContent = "Vote pour la meilleure proposition !";
    }
    
    gameState.clientVoteOpts.forEach((opt) => {
        const card = document.createElement('div');
        card.className = `vote-card ${opt.isOwn ? 'disabled' : ''}`;
        card.dataset.playerId = opt.playerId;
        
        let contentHtml = `<div class="vote-card-text">"${opt.text}"</div>`;
        if (opt.isOwn) {
            contentHtml += `<span class="own-badge">Ta proposition</span>`;
        }
        card.innerHTML = contentHtml;
        
        if (!opt.isOwn) {
            card.onclick = () => selectVoteCard(card);
        }
        container.appendChild(card);
    });
    
    document.getElementById('btn-submit-vote').disabled = true;
    document.getElementById('btn-submit-vote').onclick = submitOnlineHostVote;
}

function submitOnlineHostVote() {
    if (selectedVotePlayerId === null) return;
    
    gameState.votes.push({
        voterId: 0,
        targetId: selectedVotePlayerId
    });
    
    selectedVotePlayerId = null;
    
    // Affichage d'attente sur l'Hôte
    document.getElementById('vote-prompt-title').textContent = "Vote pris en compte !";
    document.getElementById('vote-cards-area').innerHTML = "<div class='info-text'>En attente du vote des autres...</div>";
    document.getElementById('btn-submit-vote').disabled = true;
    
    checkAllVotesSubmitted();
}

// --- Saisie du Vote (Client) ---

function setupClientVoteUI() {
    const voterName = document.getElementById('vote-voter-name');
    const container = document.getElementById('vote-cards-area');
    const voteTitle = document.getElementById('vote-prompt-title');
    
    // Mettre à jour dynamiquement la notice d'aide
    const activePlayers = getActivePlayers();
    const infoText = document.querySelector('.vote-actions .info-text');
    if (infoText) {
        if (activePlayers.length > 2) {
            infoText.textContent = "Clique sur une carte pour la sélectionner. Tu ne peux pas voter pour ta propre proposition (elle est grisée).";
        } else {
            infoText.textContent = "Clique sur une carte pour la sélectionner. Exception : à 2 joueurs, vous pouvez voter pour votre propre proposition !";
        }
    }
    
    voterName.textContent = `Votant : Toi`;
    container.innerHTML = "";
    
    if (gameState.isMortSubite) {
        voteTitle.innerHTML = `⚡ MORT SUBITE ⚡ Égalité ! Vote pour départager :`;
    } else {
        voteTitle.textContent = "Vote pour la meilleure proposition !";
    }
    
    gameState.voteOptions.forEach((opt) => {
        const card = document.createElement('div');
        card.className = `vote-card ${opt.isOwn ? 'disabled' : ''}`;
        card.dataset.playerId = opt.playerId;
        
        let contentHtml = `<div class="vote-card-text">"${opt.text}"</div>`;
        if (opt.isOwn) {
            contentHtml += `<span class="own-badge">Ta proposition</span>`;
        }
        card.innerHTML = contentHtml;
        
        if (!opt.isOwn) {
            card.onclick = () => selectVoteCard(card);
        }
        container.appendChild(card);
    });
    
    document.getElementById('btn-submit-vote').disabled = true;
    document.getElementById('btn-submit-vote').onclick = submitClientVote;
}

function submitClientVote() {
    if (selectedVotePlayerId === null) return;
    
    myConnection.send({
        type: 'SUBMIT_VOTE',
        targetId: selectedVotePlayerId
    });
    
    selectedVotePlayerId = null;
    document.getElementById('vote-prompt-title').textContent = "Vote transmis !";
    document.getElementById('vote-cards-area').innerHTML = "<div class='info-text'>En attente de l'Hôte...</div>";
    document.getElementById('btn-submit-vote').disabled = true;
}

function registerOnlineVote(playerId, targetId) {
    if (gameState.votes.some(v => v.voterId === playerId)) return;
    
    gameState.votes.push({
        voterId: playerId,
        targetId: targetId
    });
    
    checkAllVotesSubmitted();
}

function checkAllVotesSubmitted() {
    const activeCount = getActivePlayers().length;
    if (gameState.votes.length >= activeCount) {
        tallyVotes();
    }
}

// --- Saisie du Vote (Local Pass-and-play) ---

function showTransitionScreenForVote() {
    const activePlayers = getActivePlayers();
    if (gameState.activeVoterIndex >= activePlayers.length) {
        tallyVotes();
        return;
    }
    
    const currentVoter = activePlayers[gameState.activeVoterIndex];
    document.getElementById('vote-transition-avatar').textContent = "🗳️";
    document.getElementById('vote-transition-instruction').textContent = `C'est au tour de ${currentVoter.name} de voter.`;
    
    showScreen('voteTransition');
}

function proceedToVote() {
    showScreen('vote');
    setupLocalVoteUI();
}

function setupLocalVoteUI() {
    const activePlayers = getActivePlayers();
    const currentVoter = activePlayers[gameState.activeVoterIndex];
    
    // Mettre à jour dynamiquement la notice d'aide
    const infoText = document.querySelector('.vote-actions .info-text');
    if (infoText) {
        if (activePlayers.length > 2) {
            infoText.textContent = "Clique sur une carte pour la sélectionner. Tu ne peux pas voter pour ta propre proposition (elle est grisée).";
        } else {
            infoText.textContent = "Clique sur une carte pour la sélectionner. Exception : à 2 joueurs, vous pouvez voter pour votre propre proposition !";
        }
    }
    
    document.getElementById('vote-voter-name').textContent = `Votant : ${currentVoter.name}`;
    const container = document.getElementById('vote-cards-area');
    container.innerHTML = "";
    
    const voteTitle = document.getElementById('vote-prompt-title');
    if (gameState.isMortSubite) {
        voteTitle.innerHTML = `⚡ MORT SUBITE ⚡ Égalité ! Vote pour départager :`;
    } else {
        voteTitle.textContent = "Vote pour la meilleure proposition !";
    }
    
    gameState.voteOptions.forEach((opt) => {
        const isOwn = activePlayers.length > 2 ? (opt.playerId === currentVoter.id) : false;
        
        const card = document.createElement('div');
        card.className = `vote-card ${isOwn ? 'disabled' : ''}`;
        card.dataset.playerId = opt.playerId;
        
        let contentHtml = `<div class="vote-card-text">"${opt.text}"</div>`;
        if (isOwn) {
            contentHtml += `<span class="own-badge">Ta proposition</span>`;
        }
        card.innerHTML = contentHtml;
        
        if (!isOwn) {
            card.onclick = () => selectVoteCard(card);
        }
        container.appendChild(card);
    });
    
    document.getElementById('btn-submit-vote').disabled = true;
    document.getElementById('btn-submit-vote').onclick = submitLocalVote;
    
    // Démarrer le timer de 30 secondes pour le vote local
    startTimer(30);
}

function submitLocalVote() {
    if (selectedVotePlayerId === null) return;
    
    clearInterval(timerInterval);
    const activePlayers = getActivePlayers();
    const currentVoter = activePlayers[gameState.activeVoterIndex];
    
    gameState.votes.push({
        voterId: currentVoter.id,
        targetId: selectedVotePlayerId
    });
    
    selectedVotePlayerId = null;
    gameState.activeVoterIndex++;
    showTransitionScreenForVote();
}

// --- Dépouillement des votes ---

function tallyVotes() {
    clearInterval(timerInterval);
    const voteCounts = {};
    const optionsToCount = gameState.isMortSubite ? gameState.mortSubiteTies : gameState.propositions.map(p => p.playerId);
    
    optionsToCount.forEach(id => {
        voteCounts[id] = 0;
    });
    
    gameState.votes.forEach(v => {
        if (voteCounts[v.targetId] !== undefined) {
            voteCounts[v.targetId]++;
        }
    });
    
    let max = -1;
    let winners = [];
    for (let id in voteCounts) {
        const count = voteCounts[id];
        if (count > max) {
            max = count;
            winners = [parseInt(id)];
        } else if (count === max) {
            winners.push(parseInt(id));
        }
    }
    
    if (winners.length > 1) {
        if (gameState.mortSubiteCount >= 2) {
            const luckyWinner = winners[Math.floor(Math.random() * winners.length)];
            alert(`⚠️ Match nul persistant. Le sort désigne un gagnant.`);
            applyWinner(luckyWinner);
        } else {
            gameState.isMortSubite = true;
            gameState.mortSubiteTies = winners;
            gameState.mortSubiteCount++;
            
            alert(`⚡ Égalité ! Une Mort Subite est lancée.`);
            initVotePhase();
        }
    } else {
        applyWinner(winners[0]);
    }
}

function applyWinner(winnerId) {
    gameState.isMortSubite = false;
    gameState.mortSubiteTies = null;
    gameState.mortSubiteCount = 0;
    
    const phase = gameState.currentPhase;
    const round = gameState.currentRound;
    
    const winningProp = gameState.propositions.find(p => p.playerId === winnerId);
    const author = gameState.players.find(p => p.id === winnerId);
    
    let points = 0;
    if (phase === 1) {
        points = 50;
        gameState.roundData[round].word = winningProp.text.toUpperCase();
        gameState.roundData[round].wordAuthor = winnerId;
        gameState.winningWordsList.push(winningProp.text.toUpperCase());
    } else if (phase === 2) {
        points = 100;
        gameState.roundData[round].definition = winningProp.text;
        gameState.roundData[round].defAuthor = winnerId;
    } else if (phase === 3) {
        points = 150;
        gameState.roundData[round].sentence = winningProp.text;
        gameState.roundData[round].sentenceAuthor = winnerId;
    }
    
    author.score += points;
    
    if (gameState.mode === 'LOCAL') {
        showRevealScreen(winningProp.text, author.name, points);
    } else {
        // En ligne : notifier tout le monde du gagnant et des scores
        sendToAll({
            type: 'REVEAL_WINNER',
            text: winningProp.text,
            authorName: author.name,
            points: points,
            scoreboard: gameState.players
        });
        
        // Afficher l'Hôte localement
        showRevealScreen(winningProp.text, author.name, points);
        
        // Réactiver le bouton continuer UNIQUEMENT pour l'Hôte
        const btnNext = document.querySelector('#screen-reveal .scoreboard-panel .btn-primary');
        btnNext.style.display = 'inline-flex';
        btnNext.onclick = nextStepAfterReveal;
    }
}

function showRevealScreen(winningText, authorName, pointsAdded) {
    showScreen('reveal');
    
    document.getElementById('reveal-winning-text').textContent = winningText;
    document.getElementById('reveal-winner-author').textContent = authorName;
    document.getElementById('reveal-points-added').textContent = pointsAdded;
    
    renderScoreboard();
    
    if (stopConfettiFn) stopConfettiFn();
    stopConfettiFn = startConfetti('confetti-canvas');
}

function nextStepAfterReveal() {
    if (stopConfettiFn) {
        stopConfettiFn();
        stopConfettiFn = null;
    }
    
    if (gameState.currentPhase < 3) {
        gameState.currentPhase++;
        initSaisiePhase();
    } else {
        if (gameState.currentRound < gameState.roundCount) {
            gameState.currentRound++;
            startNewRound();
        } else {
            initCadavreExquisPhase();
        }
    }
}

// ==========================================================================
// ✍️ NARRATION CADAVRE EXQUIS (Séquentiel pour les deux modes)
// ==========================================================================

function initCadavreExquisPhase() {
    gameState.gamePhase = 'CADAVRE';
    gameState.cadavreSentences = [];
    gameState.activeCadavreIndex = 0;
    
    document.getElementById('global-header').classList.add('hidden');
    
    if (!checkActivePlayersCount()) return;
    
    if (gameState.mode === 'LOCAL') {
        showCadavreExquisTransition();
    } else {
        // En ligne : l'Hôte orchestrera les tours un par un
        triggerNextOnlineCadavreTurn();
    }
}

// --- Séquençage Cadavre Exquis (Réseau) ---

function triggerNextOnlineCadavreTurn() {
    const activePlayers = getActivePlayers();
    
    if (gameState.activeCadavreIndex >= activePlayers.length) {
        // Tous ont rédigé -> Révélation et vote
        initOnlineCadavreReveal();
        return;
    }
    
    const currentPlayer = activePlayers[gameState.activeCadavreIndex];
    
    // Obtenir le texte à "apercevoir"
    let peekText = "";
    if (gameState.cadavreSentences.length > 0) {
        const lastText = gameState.cadavreSentences[gameState.cadavreSentences.length - 1].text;
        const peekLen = 25;
        peekText = lastText.length > peekLen ? `... ${lastText.substring(lastText.length - peekLen)}` : lastText;
    }
    
    // Notifier tout le monde
    activePlayers.forEach((player) => {
        const isCurrentWriter = (player.id === currentPlayer.id);
        
        if (player.id !== 0) {
            const conn = connections.get(player.id);
            if (conn) {
                if (isCurrentWriter) {
                    conn.send({
                        type: 'CADAVRE_START',
                        peekText: peekText,
                        winningWords: gameState.winningWordsList,
                        duration: 90
                    });
                } else {
                    conn.send({
                        type: 'CADAVRE_WAIT',
                        writerName: currentPlayer.name
                    });
                }
            }
        } else {
            // Configurer l'hôte
            if (isCurrentWriter) {
                showScreen('cadavreExquis');
                setupOnlineHostCadavreUI(peekText, 90);
            } else {
                showScreen('cadavreExquis');
                setupClientCadavreWaitUI(currentPlayer.name);
            }
        }
    });
    
    // Si l'hôte est inactif, on doit lui configurer son écran en mode veille
    const isHostActive = gameState.players[0].active;
    if (!isHostActive) {
        showScreen('cadavreExquis');
        setupClientCadavreWaitUI(currentPlayer.name);
    }
    
    // Lancer le timer autoritaire pour ce tour de cadavre
    startCadavreTimer(90);
}

function setupOnlineHostCadavreUI(peekText, duration) {
    const wordsRack = document.getElementById('cadavre-words-list');
    wordsRack.innerHTML = "";
    gameState.winningWordsList.forEach(word => {
        const pill = document.createElement('button');
        pill.type = "button";
        pill.className = "word-pill";
        pill.textContent = word;
        pill.onclick = () => insertWordInCadavre(word);
        wordsRack.appendChild(pill);
    });
    
    const peekBox = document.getElementById('cadavre-peek-box');
    const peekTextEl = document.getElementById('cadavre-peek-text');
    
    if (peekText === "") {
        peekBox.style.display = 'none';
    } else {
        peekBox.style.display = 'block';
        peekTextEl.textContent = peekText;
    }
    
    const textarea = document.getElementById('cadavre-textarea');
    textarea.disabled = false;
    textarea.value = "";
    
    document.getElementById('btn-submit-cadavre').onclick = submitOnlineHostCadavre;
    
    validateCadavreInput();
    startCadavreTimer(duration);
    setTimeout(() => textarea.focus(), 100);
}

function submitOnlineHostCadavre() {
    clearInterval(timerInterval);
    const textarea = document.getElementById('cadavre-textarea');
    const val = textarea.value.trim();
    
    let usedWord = "";
    for (let word of gameState.winningWordsList) {
        if (val.toLowerCase().includes(word.toLowerCase())) {
            usedWord = word;
            break;
        }
    }
    
    gameState.cadavreSentences.push({
        playerId: 0,
        text: val,
        usedWord: usedWord
    });
    
    gameState.activeCadavreIndex++;
    triggerNextOnlineCadavreTurn();
}

function registerOnlineCadavre(playerId, text, usedWord) {
    clearInterval(timerInterval);
    
    // Ignorer si déjà soumis
    if (gameState.cadavreSentences.some(s => s.playerId === playerId)) return;
    
    gameState.cadavreSentences.push({
        playerId: playerId,
        text: text,
        usedWord: usedWord
    });
    
    gameState.activeCadavreIndex++;
    triggerNextOnlineCadavreTurn();
}

// --- Cadavre Exquis (Clients UIs) ---

function setupClientCadavreUI(peekText, duration) {
    const wordsRack = document.getElementById('cadavre-words-list');
    wordsRack.innerHTML = "";
    gameState.winningWordsList.forEach(word => {
        const pill = document.createElement('button');
        pill.type = "button";
        pill.className = "word-pill";
        pill.textContent = word;
        pill.onclick = () => insertWordInCadavre(word);
        wordsRack.appendChild(pill);
    });
    
    const peekBox = document.getElementById('cadavre-peek-box');
    const peekTextEl = document.getElementById('cadavre-peek-text');
    
    if (peekText === "") {
        peekBox.style.display = 'none';
    } else {
        peekBox.style.display = 'block';
        peekTextEl.textContent = peekText;
    }
    
    const textarea = document.getElementById('cadavre-textarea');
    textarea.disabled = false;
    textarea.value = "";
    
    document.getElementById('btn-submit-cadavre').onclick = submitClientCadavre;
    
    validateCadavreInput();
    
    // Affichage timer fictif
    const timerBox = document.getElementById('cadavre-timer');
    timerBox.style.display = 'block';
    document.getElementById('cadavre-timer-value').textContent = duration;
    
    setTimeout(() => textarea.focus(), 100);
}

function setupClientCadavreWaitUI(writerName) {
    // Mode veille pendant qu'un autre écrit
    const wordsRack = document.getElementById('cadavre-words-list');
    wordsRack.innerHTML = "<div class='info-text'>Attente du tour...</div>";
    
    const peekBox = document.getElementById('cadavre-peek-box');
    peekBox.style.display = 'block';
    document.getElementById('cadavre-peek-text').textContent = `${writerName} est en train d'écrire la suite de l'histoire...`;
    
    const textarea = document.getElementById('cadavre-textarea');
    textarea.disabled = true;
    textarea.value = "";
    
    document.getElementById('cadavre-timer').style.display = 'none';
    document.getElementById('btn-submit-cadavre').disabled = true;
}

function submitClientCadavre() {
    const textarea = document.getElementById('cadavre-textarea');
    const val = textarea.value.trim();
    
    let usedWord = "";
    for (let word of gameState.winningWordsList) {
        if (val.toLowerCase().includes(word.toLowerCase())) {
            usedWord = word;
            break;
        }
    }
    
    if (!usedWord) return; // Sécurité validation
    
    myConnection.send({
        type: 'SUBMIT_CADAVRE',
        text: val,
        usedWord: usedWord
    });
    
    textarea.disabled = true;
    document.getElementById('btn-submit-cadavre').disabled = true;
    document.getElementById('cadavre-peek-text').textContent = "Proposition envoyée ! Attente du joueur suivant...";
}

// --- Cadavre Exquis (Mode Local Pass-and-play) ---

function showCadavreExquisTransition() {
    const activePlayers = getActivePlayers();
    if (gameState.activeCadavreIndex >= activePlayers.length) {
        initLocalCadavreReveal();
        return;
    }
    
    const currentPlayer = activePlayers[gameState.activeCadavreIndex];
    document.getElementById('transition-avatar').textContent = "✍️";
    document.getElementById('transition-title').innerHTML = `C'est au tour de <span class="highlight-name">${currentPlayer.name}</span>`;
    document.getElementById('transition-instruction').textContent = "Tu vas devoir ajouter une phrase pour le Cadavre Exquis final !";
    
    const btnReady = document.querySelector('#screen-transition .btn-primary');
    btnReady.onclick = () => {
        showScreen('cadavreExquis');
        setupLocalCadavreUI();
    };
    showScreen('transition');
}

function setupLocalCadavreUI() {
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activeCadavreIndex];
    
    const progressPercent = (gameState.activeCadavreIndex / activePlayers.length) * 100;
    document.getElementById('cadavre-progress').style.width = `${progressPercent}%`;
    
    const wordsRack = document.getElementById('cadavre-words-list');
    wordsRack.innerHTML = "";
    gameState.winningWordsList.forEach(word => {
        const pill = document.createElement('button');
        pill.type = "button";
        pill.className = "word-pill";
        pill.textContent = word;
        pill.onclick = () => insertWordInCadavre(word);
        wordsRack.appendChild(pill);
    });
    
    const peekBox = document.getElementById('cadavre-peek-box');
    const peekText = document.getElementById('cadavre-peek-text');
    
    if (gameState.cadavreSentences.length === 0) {
        peekBox.style.display = 'none';
    } else {
        peekBox.style.display = 'block';
        const lastSentence = gameState.cadavreSentences[gameState.cadavreSentences.length - 1].text;
        const peekLen = 25;
        peekText.textContent = lastSentence.length > peekLen ? `... ${lastSentence.substring(lastSentence.length - peekLen)}` : lastSentence;
    }
    
    const textarea = document.getElementById('cadavre-textarea');
    textarea.disabled = false;
    textarea.value = "";
    
    document.getElementById('btn-submit-cadavre').onclick = submitLocalCadavre;
    
    validateCadavreInput();
    startCadavreTimer(90);
    setTimeout(() => textarea.focus(), 100);
}

function submitLocalCadavre() {
    clearInterval(timerInterval);
    const textarea = document.getElementById('cadavre-textarea');
    const val = textarea.value.trim();
    
    let usedWord = "";
    for (let word of gameState.winningWordsList) {
        if (val.toLowerCase().includes(word.toLowerCase())) {
            usedWord = word;
            break;
        }
    }
    
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activeCadavreIndex];
    
    gameState.cadavreSentences.push({
        playerId: currentPlayer.id,
        text: val,
        usedWord: usedWord
    });
    
    gameState.activeCadavreIndex++;
    showCadavreExquisTransition();
}

function insertWordInCadavre(word) {
    const textarea = document.getElementById('cadavre-textarea');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    
    textarea.value = text.substring(0, start) + word + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + word.length;
    
    validateCadavreInput();
}

function validateCadavreInput() {
    const textarea = document.getElementById('cadavre-textarea');
    const text = textarea.value.trim().toLowerCase();
    const validationMsg = document.getElementById('cadavre-validation-msg');
    const btnSubmit = document.getElementById('btn-submit-cadavre');
    
    if (text === "") {
        validationMsg.textContent = "❌ Ta phrase ne peut pas être vide.";
        validationMsg.className = "helper-note";
        btnSubmit.disabled = true;
        return;
    }
    
    let foundWord = null;
    for (let word of gameState.winningWordsList) {
        if (text.includes(word.toLowerCase())) {
            foundWord = word;
            break;
        }
    }
    
    if (foundWord) {
        validationMsg.textContent = `✅ Valide (Mot utilisé : ${foundWord})`;
        validationMsg.className = "helper-note valid";
        btnSubmit.disabled = false;
    } else {
        validationMsg.textContent = "❌ Ta contribution doit inclure au moins l'un des mots de la liste.";
        validationMsg.className = "helper-note";
        btnSubmit.disabled = true;
    }
}

// --- Timers Cadavre Exquis (Hôte autoritaire) ---

function startCadavreTimer(duration) {
    clearInterval(timerInterval);
    const timerText = document.getElementById('cadavre-timer-value');
    const timerBox = document.getElementById('cadavre-timer');
    
    if (!gameState.timerEnabled) {
        timerBox.style.display = 'none';
        return;
    }
    
    timerBox.style.display = 'block';
    timerSecondsRemaining = duration;
    timerText.textContent = timerSecondsRemaining;
    
    // Envoyer la synchro initiale s'il y a des clients
    if (gameState.mode === 'ONLINE' && gameState.isHost) {
        sendToAll({ type: 'TIMER_TICK', seconds: timerSecondsRemaining, total: duration });
    }
    
    timerInterval = setInterval(() => {
        timerSecondsRemaining--;
        timerText.textContent = timerSecondsRemaining;
        
        if (gameState.mode === 'ONLINE' && gameState.isHost) {
            sendToAll({ type: 'TIMER_TICK', seconds: timerSecondsRemaining, total: duration });
        }
        
        if (timerSecondsRemaining <= 0) {
            clearInterval(timerInterval);
            handleCadavreAFK();
        }
    }, 1000);
}

function handleCadavreAFK() {
    const activePlayers = getActivePlayers();
    
    if (gameState.mode === 'LOCAL') {
        const currentPlayer = activePlayers[gameState.activeCadavreIndex];
        const textarea = document.getElementById('cadavre-textarea');
        const val = textarea.value.trim();
        
        if (val !== "") {
            let usedWord = "";
            for (let word of gameState.winningWordsList) {
                if (val.toLowerCase().includes(word.toLowerCase())) {
                    usedWord = word;
                    break;
                }
            }
            if (usedWord) {
                gameState.cadavreSentences.push({ playerId: currentPlayer.id, text: val, usedWord: usedWord });
                alert(`⏳ Temps écoulé ! La contribution de ${currentPlayer.name} ("${val}") a été enregistrée automatiquement.`);
                gameState.activeCadavreIndex++;
                showCadavreExquisTransition();
                return;
            }
        }
        
        currentPlayer.active = false;
        alert(`💀 EXCLU ! ${currentPlayer.name} a été trop lent à écrire ou sa proposition était invalide.`);
        
        const newActive = getActivePlayers();
        if (gameState.activeCadavreIndex >= newActive.length) {
            gameState.activeCadavreIndex = newActive.length;
        }
        if (checkActivePlayersCount()) {
            showCadavreExquisTransition();
        }
    } else {
        // En ligne (Hôte gère l'AFK du rédacteur actif)
        const currentPlayer = activePlayers[gameState.activeCadavreIndex];
        
        if (currentPlayer.id === 0) {
            // Si Hôte et non-vide, auto-validation locale
            const textarea = document.getElementById('cadavre-textarea');
            const val = textarea.value.trim();
            let usedWord = "";
            for (let word of gameState.winningWordsList) {
                if (val.toLowerCase().includes(word.toLowerCase())) {
                    usedWord = word;
                    break;
                }
            }
            if (usedWord) {
                gameState.cadavreSentences.push({ playerId: 0, text: val, usedWord: usedWord });
                gameState.activeCadavreIndex++;
                triggerNextOnlineCadavreTurn();
                return;
            }
            
            // Sinon, disqualifier l'hôte
            currentPlayer.active = false;
            alert("💀 Vous avez été éliminé pour inactivité au Cadavre Exquis !");
            broadcastState();
            
            const newActive = getActivePlayers();
            if (gameState.activeCadavreIndex >= newActive.length) {
                gameState.activeCadavreIndex = newActive.length;
            }
            if (checkActivePlayersCount()) {
                triggerNextOnlineCadavreTurn();
            }
        } else {
            // Rédacteur = Client. On attend 1.5s pour laisser arriver une éventuelle auto-soumission
            setTimeout(() => {
                // Vérifier si le joueur s'est soumis ou déconnecté entre temps
                const hasSubmitted = gameState.cadavreSentences.some(s => s.playerId === currentPlayer.id);
                if (hasSubmitted || !currentPlayer.active) return;
                
                // Toujours pas soumis -> KICK
                currentPlayer.active = false;
                const conn = connections.get(currentPlayer.id);
                if (conn) {
                    conn.send({ type: 'KICK', reason: "Temps écoulé au cadavre exquis." });
                    conn.close();
                }
                
                // Diffuser la déconnexion
                sendToAll({
                    type: 'PLAYER_DISCONNECT',
                    name: currentPlayer.name,
                    players: gameState.players
                });
                
                const newActive = getActivePlayers();
                if (gameState.activeCadavreIndex >= newActive.length) {
                    gameState.activeCadavreIndex = newActive.length;
                }
                if (checkActivePlayersCount()) {
                    triggerNextOnlineCadavreTurn();
                }
            }, 1500);
        }
    }
}

// ==========================================================================
// 📖 RÉVÉLATION HISTOIRE ET VOTE CADAVRE
// ==========================================================================

function initLocalCadavreReveal() {
    showScreen('cadavreReveal');
    gameState.cadavreVotes = [];
    currentStoryVoterIdx = 0;
    
    // Définitions
    const definitionsMap = {};
    for (let r in gameState.roundData) {
        const data = gameState.roundData[r];
        definitionsMap[data.word.toUpperCase()] = data.definition;
    }
    
    const storyDiv = document.getElementById('story-full-text');
    storyDiv.innerHTML = "";
    let fullStoryHtml = "";
    gameState.cadavreSentences.forEach((sentence, idx) => {
        let sentenceText = escapeHTML(sentence.text);
        if (sentence.usedWord) {
            const wordUpper = sentence.usedWord.toUpperCase();
            const defText = escapeHTML(definitionsMap[wordUpper] || "");
            const regex = new RegExp(`(${escapeHTML(sentence.usedWord)})`, 'gi');
            sentenceText = sentenceText.replace(regex, `<span class="story-word-highlight" data-tooltip="${wordUpper} : ${defText}">$1</span>`);
        }
        fullStoryHtml += `<span class="story-paragraph" style="animation-delay: ${idx * 0.5}s">${sentenceText} </span>`;
    });
    storyDiv.innerHTML = fullStoryHtml;
    
    // Lancer le vote local
    renderLocalStoryVoteButtons();
}

function renderLocalStoryVoteButtons() {
    const activePlayers = getActivePlayers();
    const voteArea = document.getElementById('story-vote-players-area');
    const statusText = document.getElementById('story-vote-status-text');
    
    voteArea.innerHTML = "";
    
    if (currentStoryVoterIdx >= activePlayers.length) {
        tallyCadavreVotes();
        return;
    }
    
    // Démarrer le timer de 30 secondes pour le vote de la plume d'or local
    startStoryVoteTimer(30);
    
    const currentVoter = activePlayers[currentStoryVoterIdx];
    statusText.textContent = `Au tour de ${currentVoter.name} de voter...`;
    
    activePlayers.forEach(player => {
        // Exception 2 joueurs
        const isSelf = activePlayers.length > 2 ? (player.id === currentVoter.id) : false;
        
        const btn = document.createElement('button');
        btn.type = "button";
        btn.className = `btn-story-vote ${isSelf ? 'disabled' : ''}`;
        btn.innerHTML = `Voter pour <strong>${escapeHTML(player.name)}</strong> <span>👍</span>`;
        btn.disabled = isSelf;
        
        if (!isSelf) {
            btn.onclick = () => {
                clearInterval(storyVoteTimerInterval);
                gameState.cadavreVotes.push({
                    voterId: currentVoter.id,
                    targetId: player.id
                });
                currentStoryVoterIdx++;
                renderLocalStoryVoteButtons();
            };
        }
        voteArea.appendChild(btn);
    });
}

// --- Révélation Histoire (En ligne) ---

function initOnlineCadavreReveal() {
    gameState.gamePhase = 'STORY_VOTE';
    gameState.cadavreVotes = [];
    currentStoryVoterIdx = 0;
    
    // Construire la map des définitions
    const definitionsMap = {};
    for (let r in gameState.roundData) {
        const data = gameState.roundData[r];
        definitionsMap[data.word.toUpperCase()] = data.definition;
    }
    
    const activePlayers = getActivePlayers();
    
    // Diffuser aux clients
    sendToAll({
        type: 'STORY_REVEAL',
        sentences: gameState.cadavreSentences,
        definitionsMap: definitionsMap,
        activePlayers: activePlayers
    });
    
    // Afficher l'Hôte
    showScreen('cadavreReveal');
    renderOnlineStoryText(gameState.cadavreSentences, definitionsMap);
    renderOnlineStoryVoteArea(activePlayers);
    
    // Démarrer le timer de la plume d'or pour l'Hôte
    startStoryVoteTimer(30);
}

function renderOnlineStoryText(sentences, definitionsMap) {
    const storyDiv = document.getElementById('story-full-text');
    storyDiv.innerHTML = "";
    
    let fullStoryHtml = "";
    sentences.forEach((sentence, idx) => {
        let sentenceText = escapeHTML(sentence.text);
        if (sentence.usedWord) {
            const wordUpper = sentence.usedWord.toUpperCase();
            const defText = escapeHTML(definitionsMap[wordUpper] || "");
            const regex = new RegExp(`(${escapeHTML(sentence.usedWord)})`, 'gi');
            sentenceText = sentenceText.replace(regex, `<span class="story-word-highlight" data-tooltip="${wordUpper} : ${defText}">$1</span>`);
        }
        fullStoryHtml += `<span class="story-paragraph" style="animation-delay: ${idx * 0.4}s">${sentenceText} </span>`;
    });
    storyDiv.innerHTML = fullStoryHtml;
}

function renderOnlineStoryVoteArea(activePlayers) {
    const voteArea = document.getElementById('story-vote-players-area');
    voteArea.innerHTML = "";
    
    const currentVoter = activePlayers[currentStoryVoterIdx];
    const statusText = document.getElementById('story-vote-status-text');
    
    const isMyTurn = (currentVoter.id === gameState.myPlayerId);
    statusText.textContent = `Au tour de ${currentVoter.name} de voter...`;
    
    activePlayers.forEach(player => {
        // Exception 2 joueurs
        const isVoterSelf = activePlayers.length > 2 ? (player.id === currentVoter.id) : false;
        
        const btn = document.createElement('button');
        btn.type = "button";
        const canClick = isMyTurn && !isVoterSelf;
        
        btn.className = `btn-story-vote ${(!canClick) ? 'disabled' : ''}`;
        btn.innerHTML = `Voter pour <strong>${escapeHTML(player.name)}</strong> <span>👍</span>`;
        btn.disabled = !canClick;
        
        if (canClick) {
            btn.onclick = () => {
                if (gameState.isHost) {
                    registerOnlineStoryVote(0, player.id);
                } else {
                    myConnection.send({
                        type: 'SUBMIT_STORY_VOTE',
                        targetId: player.id
                    });
                }
                
                // Désactiver localement après clic
                document.querySelectorAll('.btn-story-vote').forEach(b => b.classList.add('disabled'));
            };
        }
        voteArea.appendChild(btn);
    });
}

function registerOnlineStoryVote(voterId, targetId) {
    clearInterval(storyVoteTimerInterval);
    if (gameState.cadavreVotes.some(v => v.voterId === voterId)) return;
    
    gameState.cadavreVotes.push({
        voterId: voterId,
        targetId: targetId
    });
    
    currentStoryVoterIdx++;
    
    const activePlayers = getActivePlayers();
    
    if (currentStoryVoterIdx >= activePlayers.length) {
        tallyCadavreVotes();
    } else {
        // Mettre à jour tout le monde pour le votant suivant
        sendToAll({
            type: 'STORY_VOTE_TICK',
            currentVoterName: activePlayers[currentStoryVoterIdx].name,
            activePlayers: activePlayers,
            currentVoterIdx: currentStoryVoterIdx
        });
        
        // Mettre à jour l'hôte
        renderOnlineStoryVoteArea(activePlayers);
        
        // Relancer le timer pour le votant suivant
        startStoryVoteTimer(30);
    }
}

function updateOnlineStoryVoteStatus(voterName, activePlayers, timeRemaining) {
    renderOnlineStoryVoteArea(activePlayers);
    const statusText = document.getElementById('story-vote-status-text');
    if (statusText && timeRemaining !== undefined) {
        statusText.innerHTML = `Au tour de ${escapeHTML(voterName)} de voter... (⏳ ${timeRemaining}s)`;
    }
}

function registerOnlineStoryVoteClient(voterId, targetId) {
    // Les clients reçoivent la mise à jour via STORY_VOTE_TICK
}

let storyVoteTimerInterval = null;
function startStoryVoteTimer(duration) {
    clearInterval(storyVoteTimerInterval);
    if (!gameState.timerEnabled) return;
    
    let timeRemaining = duration;
    const statusText = document.getElementById('story-vote-status-text');
    const activePlayers = getActivePlayers();
    const currentVoter = activePlayers[currentStoryVoterIdx];
    if (!currentVoter) return;
    
    statusText.innerHTML = `Au tour de ${escapeHTML(currentVoter.name)} de voter... (⏳ ${timeRemaining}s)`;
    
    // Synchro initiale
    if (gameState.mode === 'ONLINE' && gameState.isHost) {
        sendToAll({
            type: 'STORY_VOTE_TICK',
            currentVoterName: currentVoter.name,
            activePlayers: activePlayers,
            currentVoterIdx: currentStoryVoterIdx,
            timeRemaining: timeRemaining
        });
    }
    
    storyVoteTimerInterval = setInterval(() => {
        timeRemaining--;
        const currPlayers = getActivePlayers();
        const currVoter = currPlayers[currentStoryVoterIdx];
        if (!currVoter) {
            clearInterval(storyVoteTimerInterval);
            return;
        }
        
        statusText.innerHTML = `Au tour de ${escapeHTML(currVoter.name)} de voter... (⏳ ${timeRemaining}s)`;
        
        // Synchro réseau
        if (gameState.mode === 'ONLINE' && gameState.isHost) {
            sendToAll({
                type: 'STORY_VOTE_TICK',
                currentVoterName: currVoter.name,
                activePlayers: currPlayers,
                currentVoterIdx: currentStoryVoterIdx,
                timeRemaining: timeRemaining
            });
        }
        
        if (timeRemaining <= 0) {
            clearInterval(storyVoteTimerInterval);
            handleStoryVoteAFK();
        }
    }, 1000);
}

function handleStoryVoteAFK() {
    const activePlayers = getActivePlayers();
    const currentVoter = activePlayers[currentStoryVoterIdx];
    if (!currentVoter) return;
    
    currentVoter.active = false;
    alert(`💀 EXCLU ! ${currentVoter.name} a mis trop de temps à voter.`);
    
    if (gameState.mode === 'ONLINE') {
        if (gameState.isHost) {
            if (currentVoter.id !== 0) {
                const conn = connections.get(currentVoter.id);
                if (conn) {
                    conn.send({ type: 'KICK', reason: "Temps écoulé pour le vote de la Plume d'Or." });
                    conn.close();
                }
            }
            broadcastState();
            registerOnlineStoryVote(currentVoter.id, -1); // Vote blanc
        }
    } else {
        if (currentStoryVoterIdx >= getActivePlayers().length) {
            currentStoryVoterIdx = getActivePlayers().length;
        }
        if (checkActivePlayersCount()) {
            renderLocalStoryVoteButtons();
        }
    }
}

function tallyCadavreVotes() {
    const counts = {};
    const activePlayers = getActivePlayers();
    activePlayers.forEach(p => counts[p.id] = 0);
    
    gameState.cadavreVotes.forEach(v => {
        if (counts[v.targetId] !== undefined) {
            counts[v.targetId]++;
        }
    });
    
    let max = -1;
    let winners = [];
    for (let id in counts) {
        if (counts[id] > max) {
            max = counts[id];
            winners = [parseInt(id)];
        } else if (counts[id] === max) {
            winners.push(parseInt(id));
        }
    }
    
    winners.forEach(winnerId => {
        const winnerObj = gameState.players.find(p => p.id === winnerId);
        winnerObj.score += 200;
        alert(`🏆 Plume d'Or : ${winnerObj.name} remporte l'histoire (+200 pts) !`);
    });
    
    if (gameState.mode === 'LOCAL') {
        showFinalPodium();
    } else {
        // Fin en ligne
        sendToAll({
            type: 'GAME_OVER',
            podium: gameState.players
        });
        showFinalPodium();
    }
}

// --- Écran Podium final ---

function showFinalPodium() {
    showScreen('podium');
    
    const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
    
    document.querySelectorAll('.podium-col').forEach(col => col.style.display = 'none');
    
    // 1er
    if (sorted[0]) {
        document.getElementById('podium-1-name').textContent = sorted[0].name;
        document.getElementById('podium-1-score').textContent = `${sorted[0].score} pts`;
        document.querySelector('.first-place').style.display = 'flex';
    }
    // 2ème
    if (sorted[1]) {
        document.getElementById('podium-2-name').textContent = sorted[1].name;
        document.getElementById('podium-2-score').textContent = `${sorted[1].score} pts`;
        document.querySelector('.second-place').style.display = 'flex';
    }
    // 3ème
    if (sorted[2]) {
        document.getElementById('podium-3-name').textContent = sorted[2].name;
        document.getElementById('podium-3-score').textContent = `${sorted[2].score} pts`;
        document.querySelector('.third-place').style.display = 'flex';
    }
    
    const detailsList = document.getElementById('final-scoreboard-list');
    detailsList.innerHTML = "";
    sorted.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = `score-row ${!p.active ? 'cursed' : ''}`;
        row.innerHTML = `
            <div class="score-player-name">
                <span class="score-player-rank">${idx + 1}</span>
                ${p.name}
            </div>
            <div class="score-player-val">${p.score} pts</div>
        `;
        detailsList.appendChild(row);
    });
    
    if (stopConfettiFn) stopConfettiFn();
    stopConfettiFn = startConfetti('podium-confetti-canvas');
    
    // Le bouton recommencer
    const btnReset = document.querySelector('#screen-podium .btn-glow');
    if (gameState.mode === 'ONLINE') {
        // Seul l'hôte peut relancer
        btnReset.style.display = gameState.isHost ? 'inline-flex' : 'none';
        btnReset.textContent = "Retourner au Lobby Réseau";
        btnReset.onclick = () => {
            sendToAll({ type: 'KICK', reason: "La partie est terminée." });
            resetGame();
        };
    } else {
        btnReset.style.display = 'inline-flex';
        btnReset.textContent = "Recommencer une partie";
        btnReset.onclick = resetGame;
    }
}

function resetGame() {
    if (stopConfettiFn) {
        stopConfettiFn();
        stopConfettiFn = null;
    }
    
    clearInterval(timerInterval);
    if (storyVoteTimerInterval) {
        clearInterval(storyVoteTimerInterval);
    }
    cleanupNetwork();
    
    document.getElementById('global-header').classList.add('hidden');
    currentStoryVoterIdx = 0;
    
    // Reset views (garder le panneau correspondant à onlineRole)
    document.getElementById('online-host-setup').classList.toggle('hidden', onlineRole !== 'HOST');
    document.getElementById('online-client-setup').classList.toggle('hidden', onlineRole !== 'CLIENT');
    document.getElementById('online-lobby-room').classList.add('hidden');
    
    // Restaurer champs inputs
    document.getElementById('saisie-input').disabled = false;
    document.getElementById('cadavre-textarea').disabled = false;
    
    // Réinitialiser les tabs dans l'UI
    selectLobbyMode(gameState.mode);
    
    showScreen('lobby');
}

// ==========================================================================
// 🛠️ OUTILS ET UTILITAIRES
// ==========================================================================

function showScreen(screenId) {
    for (let key in screens) {
        screens[key].classList.remove('active');
    }
    screens[screenId].classList.add('active');
}

function updateGlobalHeader() {
    document.getElementById('info-round').textContent = `Manche ${gameState.currentRound}/${gameState.roundCount}`;
    
    let phaseName = "";
    if (gameState.currentPhase === 1) phaseName = "Phase 1 : Le Mot";
    else if (gameState.currentPhase === 2) phaseName = "Phase 2 : La Définition";
    else if (gameState.currentPhase === 3) phaseName = "Phase 3 : La Phrase";
    
    document.getElementById('info-phase').textContent = phaseName;
}

function getActivePlayers() {
    return gameState.players.filter(p => p.active);
}

function checkActivePlayersCount() {
    const activeCount = getActivePlayers().length;
    if (activeCount < 2) {
        clearInterval(timerInterval);
        alert("⚠️ Il y a moins de 2 joueurs actifs. Fin de la partie !");
        
        if (gameState.mode === 'ONLINE' && gameState.isHost) {
            sendToAll({
                type: 'GAME_OVER',
                podium: gameState.players
            });
        }
        showFinalPodium();
        return false;
    }
    return true;
}

let selectedVotePlayerId = null;

function selectVoteCard(card) {
    document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedVotePlayerId = parseInt(card.dataset.playerId);
    document.getElementById('btn-submit-vote').disabled = false;
}

// Corriger le fait que renderScoreboard n'était pas défini
// (utilisé au reveal_winner et au disconnect)

function generateLetters() {
    let letters = [];
    const vowelCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < vowelCount; i++) {
        letters.push(VOWELS[Math.floor(Math.random() * VOWELS.length)]);
    }
    while (letters.length < 7) {
        letters.push(CONSONANTS[Math.floor(Math.random() * CONSONANTS.length)]);
    }
    return letters.sort(() => Math.random() - 0.5);
}

// --- Confetti Canvas Engine (100% Autonome) ---

function startConfetti(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
    
    let particles = [];
    const colors = ['#ff4757', '#2e86de', '#ffa502', '#ffffff'];
    
    for (let i = 0; i < 120; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            r: Math.random() * 5 + 4,
            d: Math.random() * canvas.height,
            color: colors[Math.floor(Math.random() * colors.length)],
            tilt: Math.random() * 10 - 5,
            tiltAngleIncremental: Math.random() * 0.07 + 0.02,
            tiltAngle: 0
        });
    }
    
    let animationFrameId;
    
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let active = false;
        
        particles.forEach((p, index) => {
            p.tiltAngle += p.tiltAngleIncremental;
            p.y += (Math.cos(p.d) + 3 + p.r / 2) / 3.5;
            p.x += Math.sin(p.tiltAngle) * 0.5;
            p.tilt = Math.sin(p.tiltAngle - index / 3) * 12;
            
            if (p.y < canvas.height) {
                active = true;
            }
            
            ctx.beginPath();
            ctx.lineWidth = p.r;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
            ctx.stroke();
        });
        
        if (active) {
            animationFrameId = requestAnimationFrame(draw);
        }
    }
    
    draw();
    
    return () => {
        cancelAnimationFrame(animationFrameId);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
}

// --- Stubs de fonctions pour les clics HTML inline (correction B1) ---

function submitSaisie() {
    if (gameState.mode === 'LOCAL') {
        submitLocalSaisie();
    } else if (gameState.isHost) {
        submitOnlineHostSaisie();
    } else {
        submitClientSaisie();
    }
}

function submitVote() {
    if (gameState.mode === 'LOCAL') {
        submitLocalVote();
    } else if (gameState.isHost) {
        submitOnlineHostVote();
    } else {
        submitClientVote();
    }
}

function submitCadavreSentence() {
    if (gameState.mode === 'LOCAL') {
        submitLocalCadavre();
    } else if (gameState.isHost) {
        submitOnlineHostCadavre();
    } else {
        submitClientCadavre();
    }
}

// --- Gestion des touches du clavier pour l'Input (correction M2) ---

function handleSaisieKeydown(event) {
    if (event.key === 'Enter') {
        const btn = document.getElementById('btn-submit-saisie');
        if (btn && !btn.disabled) {
            btn.click();
        }
    }
}
