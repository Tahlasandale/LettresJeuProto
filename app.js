/* ==========================================================================
   NÉOLOGIX - GAME ENGINE (app.js)
   Vanilla JS - Logic, State Management, Timers & Animations
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
    players: [],             // { id, name, score, active: true, initialIndex }
    roundCount: 2,           // Nombre de manches total
    currentRound: 1,         // Manche en cours (1 à roundCount)
    currentPhase: 1,         // Phase en cours (1 = Mot, 2 = Définition, 3 = Phrase)
    timerEnabled: true,      // Active/Désactive la limite de temps
    
    // Données par manche
    roundData: {},           // { roundIndex: { letters: [], word: '', wordAuthor: id, definition: '', defAuthor: id, sentence: '', sentenceAuthor: id } }
    
    // Stockage temporaire pour la phase en cours
    propositions: [],        // { playerId, text }
    votes: [],               // { voterId, targetId }
    
    // Index pour le Pass-and-play
    activePlayerIndex: 0,    // Qui est en train d'écrire
    activeVoterIndex: 0,     // Qui est en train de voter
    
    // Mort Subite (Gestion des égalités)
    mortSubiteTies: null,    // Array de playerIds si égalité active
    isMortSubite: false,     // Flag de revote actif
    mortSubiteCount: 0,      // Compteur de revotes pour éviter la boucle infinie
    
    // Cadavre Exquis
    cadavreSentences: [],    // { playerId, text }
    cadavreVotes: [],        // { voterId, targetId }
    activeCadavreIndex: 0,   // Joueur en train de rédiger
    winningWordsList: [],    // Liste plate des mots gagnants à utiliser
};

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
    toggleTimerSettings(); // Initialise l'état de l'affichage du timer
});

// --- Gestion de la Configuration (Lobby) ---

function adjustRounds(amount) {
    const roundInput = document.getElementById('round-count');
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

function addPlayerField() {
    const container = document.getElementById('players-list-input');
    const currentCount = container.children.length;
    
    if (currentCount >= 4) {
        alert("Maximum 4 joueurs pour ce prototype local.");
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
    
    // Masquer le bouton d'ajout si on atteint le max
    if (container.children.length === 4) {
        document.getElementById('btn-add-player').style.display = 'none';
    }
}

function removePlayerField(button) {
    const row = button.parentElement;
    const container = document.getElementById('players-list-input');
    row.remove();
    
    // Réindexer les numéros
    Array.from(container.children).forEach((child, index) => {
        child.querySelector('.player-num').textContent = `J${index + 1}`;
    });
    
    // Réafficher le bouton d'ajout si en dessous du max
    if (container.children.length < 4) {
        document.getElementById('btn-add-player').style.display = 'inline-flex';
    }
}

// --- Lancement de la Partie ---

function startGame() {
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

// --- Lancement d'une Nouvelle Manche ---

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
    
    // Préparer la phase de saisie du Mot
    initSaisiePhase();
}

function generateLetters() {
    let letters = [];
    
    // Minimum 2 voyelles obligatoires
    const vowelCount = 2 + Math.floor(Math.random() * 2); // 2 ou 3 voyelles
    for (let i = 0; i < vowelCount; i++) {
        letters.push(VOWELS[Math.floor(Math.random() * VOWELS.length)]);
    }
    
    // Compléter avec des consonnes
    while (letters.length < 7) {
        letters.push(CONSONANTS[Math.floor(Math.random() * CONSONANTS.length)]);
    }
    
    // Mélanger le tirage
    return letters.sort(() => Math.random() - 0.5);
}

// --- Phase de Saisie (Pass-and-play) ---

function initSaisiePhase() {
    gameState.propositions = [];
    gameState.activePlayerIndex = 0;
    
    // S'assurer qu'au moins 2 joueurs sont actifs
    if (!checkActivePlayersCount()) return;
    
    showTransitionScreenForInput();
}

function checkActivePlayersCount() {
    const activeCount = gameState.players.filter(p => p.active).length;
    if (activeCount < 2) {
        clearInterval(timerInterval);
        alert("🚨 Pas assez de joueurs actifs pour continuer la partie ! Tout le monde a été maudit ?");
        endGameDirectly();
        return false;
    }
    return true;
}

function getActivePlayers() {
    return gameState.players.filter(p => p.active);
}

function showTransitionScreenForInput() {
    const activePlayers = getActivePlayers();
    if (gameState.activePlayerIndex >= activePlayers.length) {
        // Tous les joueurs actifs ont saisi leur proposition -> Phase de vote !
        initVotePhase();
        return;
    }
    
    const currentPlayer = activePlayers[gameState.activePlayerIndex];
    
    // Mettre à jour l'en-tête global
    updateGlobalHeader();
    
    // Configurer l'écran de transition
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
    
    showScreen('transition');
}

function proceedToSaisie() {
    showScreen('saisie');
    setupSaisieUI();
}

function setupSaisieUI() {
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activePlayerIndex];
    const round = gameState.currentRound;
    const phase = gameState.currentPhase;
    
    // Titres et helper
    const promptTitle = document.getElementById('saisie-prompt-title');
    const contextArea = document.getElementById('saisie-context-area');
    const helperText = document.getElementById('saisie-helper-text');
    const inputLabel = document.getElementById('saisie-input-label');
    const inputField = document.getElementById('saisie-input');
    
    inputField.value = "";
    
    // Barre de progression
    const progressPercent = ((gameState.activePlayerIndex) / activePlayers.length) * 100;
    document.getElementById('saisie-progress').style.width = `${progressPercent}%`;
    
    if (phase === 1) {
        promptTitle.textContent = "Invente ton mot !";
        inputLabel.textContent = "Néologisme";
        inputField.placeholder = "Tape ton mot inventé...";
        helperText.textContent = "Utilise les lettres ci-dessus. Pas de dictionnaire, fais jouer ta mauvaise foi !";
        
        // Rendre les lettres sous forme de Scrabble
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
    
    // Focus l'input
    setTimeout(() => inputField.focus(), 100);
    
    // Gérer le Chronomètre
    startTimer(phase === 1 ? 30 : 90);
}

function handleSaisieKeydown(event) {
    if (event.key === 'Enter') {
        submitSaisie();
    }
}

function submitSaisie() {
    const inputField = document.getElementById('saisie-input');
    const val = inputField.value.trim();
    
    if (val === "") {
        alert("Tu ne peux pas valider une proposition vide !");
        return;
    }
    
    // Validation spécifique pour la Phase 1 (uniquement des lettres et provenant du tirage)
    if (gameState.currentPhase === 1) {
        if (!/^[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÇœŒæÆ-]+$/.test(val)) {
            alert("Un mot ne doit contenir que des lettres ou un tiret ! Pas d'espaces ni de chiffres.");
            return;
        }
        if (val.length < 2) {
            alert("Ton mot doit faire au moins 2 lettres.");
            return;
        }
        // Vérification hardcodée que le mot créé ne contient que les lettres du tirage
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
            alert(`Ton mot ne peut contenir que les lettres du tirage de cette manche : ${gameState.roundData[gameState.currentRound].letters.join(', ')}`);
            return;
        }
    }
    
    // Validation spécifique pour la Phase 3 (doit inclure le mot officiel)
    if (gameState.currentPhase === 3) {
        const officialWord = gameState.roundData[gameState.currentRound].word.toLowerCase();
        // Regex simplifiée pour trouver le mot sans être trop strict sur la ponctuation autour
        const normalizedVal = val.toLowerCase();
        if (!normalizedVal.includes(officialWord)) {
            alert(`Ta phrase doit impérativement contenir le mot "${gameState.roundData[gameState.currentRound].word}" !`);
            return;
        }
    }
    
    // Enregistrer
    clearInterval(timerInterval);
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activePlayerIndex];
    
    gameState.propositions.push({
        playerId: currentPlayer.id,
        text: val
    });
    
    // Passer au joueur suivant
    gameState.activePlayerIndex++;
    showTransitionScreenForInput();
}

// --- Système de Chronomètre & Gestion de l'AFK ---

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
    
    // Dash offset initial
    timerBar.style.strokeDashoffset = 0;
    
    timerInterval = setInterval(() => {
        timerSecondsRemaining--;
        timerText.textContent = timerSecondsRemaining;
        
        // Calcul de la barre de progression circulaire
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
    
    // Si à la fin du timer le champ est non vide, le contenu est pris comme réponse si valide
    if (val !== "") {
        let isValid = true;
        if (gameState.currentPhase === 1) {
            // Validation alphabet + tirets + longueur
            if (!/^[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÇœŒæÆ-]+$/.test(val) || val.length < 2) {
                isValid = false;
            } else {
                // Validation des lettres imposées
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
            // Validation présence du mot officiel
            const officialWord = gameState.roundData[gameState.currentRound].word.toLowerCase();
            if (!val.toLowerCase().includes(officialWord)) {
                isValid = false;
            }
        }
        
        if (isValid) {
            // Validation automatique réussie !
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
    
    // Sinon (vide ou invalide), exclure le joueur (Maudit)
    currentPlayer.active = false;
    alert(`💀 MALÉDICTION ! ${currentPlayer.name} n'a pas répondu à temps ou sa proposition en cours était invalide ! Il est exclu de la partie.`);
    
    // Nettoyer l'input
    document.getElementById('saisie-input').value = "";
    
    const newActivePlayers = getActivePlayers();
    if (gameState.activePlayerIndex >= newActivePlayers.length) {
        gameState.activePlayerIndex = newActivePlayers.length; // Sera géré au prochain appel de showTransitionScreenForInput
    }
    
    // Vérifier s'il reste assez de joueurs
    if (checkActivePlayersCount()) {
        showTransitionScreenForInput();
    }
}

// --- Phase de Vote (Pass-and-play secret) ---

function initVotePhase() {
    gameState.votes = [];
    gameState.activeVoterIndex = 0;
    
    // Ne mélanger les cartes qu'au début de la phase de vote global (pas à chaque sous-vote)
    // Sauf si on est en Mort Subite, là on filtre
    prepareVoteOptions();
    
    showTransitionScreenForVote();
}

function prepareVoteOptions() {
    let rawOptions = [];
    
    if (gameState.isMortSubite && gameState.mortSubiteTies) {
        // En mort subite, on ne vote que pour les propositions à égalité
        rawOptions = gameState.propositions.filter(p => gameState.mortSubiteTies.includes(p.playerId));
    } else {
        rawOptions = gameState.propositions;
    }
    
    // Mélanger pour l'anonymat
    gameState.voteOptions = [...rawOptions].sort(() => Math.random() - 0.5);
}

function showTransitionScreenForVote() {
    const activePlayers = getActivePlayers();
    if (gameState.activeVoterIndex >= activePlayers.length) {
        // Tous les joueurs actifs ont voté -> Résolution des votes !
        tallyVotes();
        return;
    }
    
    const currentVoter = activePlayers[gameState.activeVoterIndex];
    
    // Titres de l'écran de transition
    document.getElementById('vote-transition-avatar').textContent = "🗳️";
    document.getElementById('vote-transition-instruction').textContent = `C'est au tour de ${currentVoter.name} de voter.`;
    
    showScreen('voteTransition');
}

function proceedToVote() {
    showScreen('vote');
    setupVoteUI();
}

function setupVoteUI() {
    const activePlayers = getActivePlayers();
    const currentVoter = activePlayers[gameState.activeVoterIndex];
    
    document.getElementById('vote-voter-name').textContent = `Votant : ${currentVoter.name}`;
    
    // Mots / Définitions à afficher
    const container = document.getElementById('vote-cards-area');
    container.innerHTML = "";
    
    // Titre de consigne
    const voteTitle = document.getElementById('vote-prompt-title');
    if (gameState.isMortSubite) {
        voteTitle.innerHTML = `⚡ MORT SUBITE ⚡ Égalité ! Vote pour départager :`;
    } else {
        if (gameState.currentPhase === 1) {
            voteTitle.textContent = "Vote pour le meilleur mot !";
        } else if (gameState.currentPhase === 2) {
            voteTitle.textContent = `Quelle est la meilleure définition de "${gameState.roundData[gameState.currentRound].word}" ?`;
        } else if (gameState.currentPhase === 3) {
            voteTitle.textContent = "Quelle phrase est la plus drôle/adaptée ?";
        }
    }
    
    // Générer les cartes
    gameState.voteOptions.forEach((opt) => {
        const isOwn = (opt.playerId === currentVoter.id);
        
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
    
    // Désactiver le bouton de validation de base
    document.getElementById('btn-submit-vote').disabled = true;
}

let selectedVotePlayerId = null;

function selectVoteCard(card) {
    // Déselectionner les autres
    document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('selected'));
    
    // Sélectionner celle-ci
    card.classList.add('selected');
    selectedVotePlayerId = parseInt(card.dataset.playerId);
    
    // Activer le bouton de validation
    document.getElementById('btn-submit-vote').disabled = false;
}

function submitVote() {
    if (selectedVotePlayerId === null) return;
    
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

// --- Résolution des votes & Détermination du gagnant ---

function tallyVotes() {
    const voteCounts = {};
    
    // Initialiser les compteurs
    const optionsToCount = gameState.isMortSubite ? gameState.mortSubiteTies : gameState.propositions.map(p => p.playerId);
    optionsToCount.forEach(id => {
        voteCounts[id] = 0;
    });
    
    // Compter
    gameState.votes.forEach(v => {
        if (voteCounts[v.targetId] !== undefined) {
            voteCounts[v.targetId]++;
        }
    });
    
    // Trouver le maximum de votes
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
    
    // Cas de la Mort Subite (Égalité)
    if (winners.length > 1) {
        // Pour éviter une boucle infinie de Mort Subite locale si les joueurs font exprès d'égaliser
        if (gameState.mortSubiteCount >= 2) {
            // Trancher de manière aléatoire
            const luckyWinner = winners[Math.floor(Math.random() * winners.length)];
            alert(`⚠️ Encore une égalité ! Pour débloquer la partie, le destin a tiré un gagnant au sort.`);
            applyWinner(luckyWinner);
        } else {
            // Activer la Mort Subite
            gameState.isMortSubite = true;
            gameState.mortSubiteTies = winners;
            gameState.mortSubiteCount++;
            
            alert(`⚡ ÉGALITÉ ! Une Mort Subite est déclenchée pour départager les gagnants !`);
            
            // Relancer les votes avec les cibles restreintes
            initVotePhase();
        }
    } else {
        // Vainqueur unique !
        applyWinner(winners[0]);
    }
}

function applyWinner(winnerId) {
    // Reset flags de Mort Subite
    gameState.isMortSubite = false;
    gameState.mortSubiteTies = null;
    gameState.mortSubiteCount = 0;
    
    const phase = gameState.currentPhase;
    const round = gameState.currentRound;
    
    // Retrouver la proposition gagnante
    const winningProp = gameState.propositions.find(p => p.playerId === winnerId);
    const author = gameState.players.find(p => p.id === winnerId);
    
    // Assigner les scores et enregistrer dans l'historique de manche
    let points = 0;
    if (phase === 1) {
        points = 50;
        gameState.roundData[round].word = winningProp.text.toUpperCase();
        gameState.roundData[round].wordAuthor = winnerId;
        // Ajouter le mot gagnant à la liste pour le cadavre exquis
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
    
    // Afficher l'écran de révélation
    showRevealScreen(winningProp.text, author.name, points);
}

function showRevealScreen(winningText, authorName, pointsAdded) {
    showScreen('reveal');
    
    document.getElementById('reveal-winning-text').textContent = winningText;
    document.getElementById('reveal-winner-author').textContent = authorName;
    document.getElementById('reveal-points-added').textContent = pointsAdded;
    
    // Générer le tableau des scores
    renderScoreboard();
    
    // Confettis !
    if (stopConfettiFn) stopConfettiFn();
    stopConfettiFn = startConfetti('confetti-canvas');
}

function renderScoreboard() {
    const list = document.getElementById('scoreboard-list');
    list.innerHTML = "";
    
    // Trier les joueurs par score (les maudits en bas)
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
                ${p.name}
            </div>
            <div class="score-player-val">${p.score} pts</div>
        `;
        list.innerHTML += row.outerHTML;
    });
}

function nextStepAfterReveal() {
    if (stopConfettiFn) {
        stopConfettiFn();
        stopConfettiFn = null;
    }
    
    // Passer à l'étape suivante
    if (gameState.currentPhase < 3) {
        gameState.currentPhase++;
        initSaisiePhase();
    } else {
        // Fin de la manche
        if (gameState.currentRound < gameState.roundCount) {
            gameState.currentRound++;
            startNewRound();
        } else {
            // Toutes les manches sont terminées -> Cadavre Exquis !
            initCadavreExquisPhase();
        }
    }
}

// --- Phase Cadavre Exquis (Narratif) ---

function initCadavreExquisPhase() {
    gameState.cadavreSentences = [];
    gameState.activeCadavreIndex = 0;
    
    // Masquer le header
    document.getElementById('global-header').classList.add('hidden');
    
    if (!checkActivePlayersCount()) return;
    
    showCadavreExquisTransition();
}

function showCadavreExquisTransition() {
    const activePlayers = getActivePlayers();
    if (gameState.activeCadavreIndex >= activePlayers.length) {
        // Tous les joueurs ont rédigé -> Révélation de l'histoire et vote final !
        initCadavreRevealPhase();
        return;
    }
    
    const currentPlayer = activePlayers[gameState.activeCadavreIndex];
    
    document.getElementById('transition-avatar').textContent = "✍️";
    document.getElementById('transition-title').innerHTML = `C'est au tour de <span class="highlight-name">${currentPlayer.name}</span>`;
    document.getElementById('transition-instruction').textContent = "Tu vas devoir ajouter une phrase pour le Cadavre Exquis final !";
    
    // Rediriger le clic de transition vers l'écran cadavre
    const btnReady = document.querySelector('#screen-transition .btn-primary');
    btnReady.onclick = () => {
        showScreen('cadavreExquis');
        setupCadavreUI();
    };
    
    showScreen('transition');
}

function setupCadavreUI() {
    // Restaurer le clic par défaut du bouton de transition au cas où
    setTimeout(() => {
        document.querySelector('#screen-transition .btn-primary').onclick = proceedToSaisie;
    }, 500);
    
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activeCadavreIndex];
    
    // Progression
    const progressPercent = (gameState.activeCadavreIndex / activePlayers.length) * 100;
    document.getElementById('cadavre-progress').style.width = `${progressPercent}%`;
    
    // Mots gagnants sélectionnables
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
    
    // Gérer l'aperçu du texte précédent (Pass-and-play aveugle)
    const peekBox = document.getElementById('cadavre-peek-box');
    const peekText = document.getElementById('cadavre-peek-text');
    
    if (gameState.cadavreSentences.length === 0) {
        peekBox.style.display = 'none';
    } else {
        peekBox.style.display = 'block';
        const lastSentence = gameState.cadavreSentences[gameState.cadavreSentences.length - 1].text;
        
        // N'afficher que la fin (les 25 derniers caractères)
        const peekLen = 25;
        if (lastSentence.length > peekLen) {
            peekText.textContent = `... ${lastSentence.substring(lastSentence.length - peekLen)}`;
        } else {
            peekText.textContent = lastSentence;
        }
    }
    
    // Champ de texte
    const textarea = document.getElementById('cadavre-textarea');
    textarea.value = "";
    
    validateCadavreInput();
    
    // Chronomètre du cadavre exquis (90s)
    startCadavreTimer(90);
    
    setTimeout(() => textarea.focus(), 100);
}

function insertWordInCadavre(word) {
    const textarea = document.getElementById('cadavre-textarea');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    
    textarea.value = text.substring(0, start) + word + text.substring(end);
    textarea.focus();
    // Positionner le curseur juste après le mot inséré
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
    
    // Vérifier la présence d'au moins un mot gagnant
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
    
    timerInterval = setInterval(() => {
        timerSecondsRemaining--;
        timerText.textContent = timerSecondsRemaining;
        
        if (timerSecondsRemaining <= 0) {
            clearInterval(timerInterval);
            handleCadavreAFK();
        }
    }, 1000);
}

function handleCadavreAFK() {
    const activePlayers = getActivePlayers();
    const currentPlayer = activePlayers[gameState.activeCadavreIndex];
    const textarea = document.getElementById('cadavre-textarea');
    const val = textarea.value.trim();
    
    // Si à la fin du timer le champ est non vide, le contenu est pris comme réponse si valide
    if (val !== "") {
        let usedWord = "";
        for (let word of gameState.winningWordsList) {
            if (val.toLowerCase().includes(word.toLowerCase())) {
                usedWord = word;
                break;
            }
        }
        
        if (usedWord) {
            clearInterval(timerInterval);
            gameState.cadavreSentences.push({
                playerId: currentPlayer.id,
                text: val,
                usedWord: usedWord
            });
            alert(`⏳ Temps écoulé ! La contribution de ${currentPlayer.name} ("${val}") a été enregistrée automatiquement.`);
            gameState.activeCadavreIndex++;
            showCadavreExquisTransition();
            return;
        }
    }
    
    currentPlayer.active = false;
    alert(`💀 EXCLU ! ${currentPlayer.name} a été trop lent à écrire ou sa proposition en cours ne contenait aucun mot gagnant !`);
    
    // Pas d'incrément sur activeCadavreIndex car la liste se décale
    const newActive = getActivePlayers();
    if (gameState.activeCadavreIndex >= newActive.length) {
        gameState.activeCadavreIndex = newActive.length;
    }
    
    if (checkActivePlayersCount()) {
        showCadavreExquisTransition();
    }
}

function submitCadavreSentence() {
    clearInterval(timerInterval);
    const textarea = document.getElementById('cadavre-textarea');
    const val = textarea.value.trim();
    
    // Trouver le mot utilisé pour le surlignage futur
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

// --- Révélation Histoire & Vote Final ---

function initCadavreRevealPhase() {
    showScreen('cadavreReveal');
    gameState.cadavreVotes = [];
    
    // 1. Construire l'histoire complète avec des tooltips sur les mots inventés
    const storyDiv = document.getElementById('story-full-text');
    storyDiv.innerHTML = "";
    
    // On va mapper les définitions pour les infobulles (tooltips)
    const definitionsMap = {};
    for (let r in gameState.roundData) {
        const data = gameState.roundData[r];
        definitionsMap[data.word.toUpperCase()] = data.definition;
    }
    
    let fullStoryHtml = "";
    gameState.cadavreSentences.forEach((sentence, idx) => {
        let sentenceText = sentence.text;
        
        // Remplacer le mot utilisé par sa version surlignée avec infobulle
        if (sentence.usedWord) {
            const wordUpper = sentence.usedWord.toUpperCase();
            const defText = definitionsMap[wordUpper] || "Pas de définition trouvée.";
            
            // Remplacement insensible à la casse
            const regex = new RegExp(`(${sentence.usedWord})`, 'gi');
            sentenceText = sentenceText.replace(regex, `<span class="story-word-highlight" data-tooltip="${wordUpper} : ${defText}">$1</span>`);
        }
        
        // Ajouter un petit effet de retard pour l'affichage graduel (facultatif mais cool)
        fullStoryHtml += `<span class="story-paragraph" style="animation-delay: ${idx * 0.5}s">${sentenceText} </span>`;
    });
    
    storyDiv.innerHTML = fullStoryHtml;
    
    // 2. Construire la zone de vote pour les joueurs du cadavre
    const voteArea = document.getElementById('story-vote-players-area');
    voteArea.innerHTML = "";
    
    // Chaque joueur actif doit pouvoir voter pour le meilleur contributeur
    // Pour simplifier et ne pas avoir une boucle infinie de transition, on fait un vote à main levée ou séquentiel
    // Mais pour garder l'aspect Pass-and-play, on va faire un vote "chacun son tour" simplifié à l'écran
    // Ou un écran de transition rapide. Pour faire simple et efficace dans l'UI :
    // On affiche des boutons "Voter en tant que [Pseudo]" qui ouvrent un mini-prompt ou qui masquent temporairement.
    // Mettons en place une mécanique de boutons séquentiels de vote :
    renderStoryVoteButtons();
}

let currentStoryVoterIdx = 0;

function renderStoryVoteButtons() {
    const activePlayers = getActivePlayers();
    const voteArea = document.getElementById('story-vote-players-area');
    const statusText = document.getElementById('story-vote-status-text');
    
    voteArea.innerHTML = "";
    
    if (currentStoryVoterIdx >= activePlayers.length) {
        // Tous ont voté ! Calculer le vainqueur du Cadavre Exquis
        tallyCadavreVotes();
        return;
    }
    
    const currentVoter = activePlayers[currentStoryVoterIdx];
    statusText.textContent = `Au tour de ${currentVoter.name} de voter...`;
    
    // Afficher des boutons pour chaque AUTRE joueur
    activePlayers.forEach(player => {
        const isSelf = (player.id === currentVoter.id);
        
        const btn = document.createElement('button');
        btn.type = "button";
        btn.className = `btn-story-vote ${isSelf ? 'disabled' : ''}`;
        btn.innerHTML = `Voter pour <strong>${player.name}</strong> <span>👍</span>`;
        btn.disabled = isSelf;
        
        if (!isSelf) {
            btn.onclick = () => {
                gameState.cadavreVotes.push({
                    voterId: currentVoter.id,
                    targetId: player.id
                });
                currentStoryVoterIdx++;
                renderStoryVoteButtons();
            };
        }
        
        voteArea.appendChild(btn);
    });
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
    
    // Trouver le vainqueur
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
    
    // Attribuer les points (+200 pts), si égalité on partage
    winners.forEach(winnerId => {
        const winnerObj = gameState.players.find(p => p.id === winnerId);
        winnerObj.score += 200;
        alert(`🏆 Plume d'Or : ${winnerObj.name} remporte le vote de l'histoire (+200 pts) !`);
    });
    
    // Passer au podium final
    showFinalPodium();
}

// --- Écran Podium & Fin de Partie ---

function showFinalPodium() {
    showScreen('podium');
    
    // Trier tous les joueurs (actifs et maudits)
    const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
    
    const podiumNames = ['podium-1', 'podium-2', 'podium-3'];
    const emojis = ['👑', '🥈', '🥉'];
    
    // Réinitialiser l'affichage
    document.querySelectorAll('.podium-col').forEach(col => col.style.display = 'none');
    
    // Remplir le podium
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
    
    // Remplir les détails
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
    
    // Lancer les confettis du podium
    if (stopConfettiFn) stopConfettiFn();
    stopConfettiFn = startConfetti('podium-confetti-canvas');
}

function endGameDirectly() {
    clearInterval(timerInterval);
    showFinalPodium();
}

function resetGame() {
    if (stopConfettiFn) {
        stopConfettiFn();
        stopConfettiFn = null;
    }
    
    // Revenir au lobby
    document.getElementById('global-header').classList.add('hidden');
    currentStoryVoterIdx = 0;
    showScreen('lobby');
}

// --- Fonctions Utilitaires ---

function showScreen(screenId) {
    // Cacher tous les écrans
    for (let key in screens) {
        screens[key].classList.remove('active');
    }
    // Afficher l'écran demandé
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

// --- Confetti Canvas Engine (100% Autonome) ---

function startConfetti(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    
    // Redimensionner le canvas au parent
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
    
    let particles = [];
    const colors = ['#ff1f7b', '#00f0ff', '#ffd700', '#39ff14', '#ffffff'];
    
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
