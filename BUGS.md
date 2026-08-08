# Rapport de bugs — Néologix

Audit réalisé le 8 août 2026 par double analyse parallèle du code (mode Local + mode En Ligne), chaque bug a été re-vérifié dans le code source.

Fichiers concernés : `app.js` (2631 lignes), `index.html` (394 lignes), `style.css` (1516 lignes).
Références : `fichier:ligne`.

Légende sévérité : 🔴 CRITIQUE (blocage/plantage) · 🟠 HAUTE · 🟡 MOYENNE · 🟢 BASSE

---

## 🔴 CRITIQUES

### C1 — Vote client en ligne : variable `card` globale → tout clic vote pour la dernière carte
- **Fichier:ligne** : `app.js:1439` (comparer hôte correct : `app.js:1384` avec `const card`)
- **Description** : dans `setupClientVoteUI`, la variable de boucle `card` n'est pas déclarée (`card = document.createElement('div')`). Après la boucle, la `card` globale référence la dernière carte créée ; toutes les closures `card.onclick = () => selectVoteCard(card)` capturent cette globale.
- **Symptôme** : le client clique sur « Option B » mais c'est la dernière carte qui se met en surbrillance ; le vote envoyé vise la dernière proposition (voire soi-même si c'est sa propre carte). Tous les votes convergent vers une seule cible.
- **Correctif** : déclarer `const card = document.createElement('div');` (identique à l'UI hôte).

### C2 — Vote d'histoire en ligne désynchronisé → partie bloquée pour toujours
- **Fichier:ligne** : `app.js:2302`, `app.js:2348`, `app.js:2356-2360` (hôte), `app.js:535`, `app.js:542-545`, `app.js:2367-2369` (client)
- **Description** : l'hôte incrémente `currentStoryVoterIdx` et envoie `STORY_VOTE_TICK`, mais le client n'incrémente jamais son propre index (resté à 0 depuis `STORY_REVEAL`). Le handler client appelle `updateOnlineStoryVoteStatus(voterName, activePlayers)` qui ignore `currentVoterName` et re-rend depuis l'index périmé.
- **Symptôme** : après le vote du premier votant (souvent l'hôte), chaque client voit « Au tour de [joueur 1] » avec tous les boutons désactivés. Le podium final n'est jamais atteint.
- **Correctif** : inclure l'index dans le message (`{ type:'STORY_VOTE_TICK', voterIdx: currentStoryVoterIdx, activePlayers }`) et affecter `currentStoryVoterIdx = data.voterIdx` côté client ; ou envoyer `currentVoterId` et résoudre via `activePlayers.find(p => p.id === currentVoterId)`.

### C3 — Cadavre exquis en ligne : aucun timer/AFK quand un client écrit → blocage
- **Fichier:ligne** : `app.js:1718-1769` (`triggerNextOnlineCadavreTurn`), `app.js:1800` (timer seulement si hôte écrit), `app.js:1845-1881` (`setupClientCadavreUI`), `app.js:2135` (`handleCadavreAFK` conditionné à `activeCadavreIndex === 0`)
- **Description** : `startCadavreTimer(90)` n'est appelé que quand l'hôte est l'écrivain. Quand un client écrit, l'hôte envoie `CADAVRE_START` sans timer. Côté client, `setupClientCadavreUI` n'affiche la durée que statiquement (pas de compte à rebours, pas d'auto-soumission à l'expiration).
- **Symptôme** : le client-écrivain voit « 90s » figé sans échéance ; s'il ne clique pas « Valider ma phrase » (ou si son onglet est throttlé), toute la partie attend indéfiniment.
- **Correctif** : démarrer un timer hôte-autoritaire `startCadavreTimer(90)` à chaque tour (envoyer `TIMER_TICK` à tous), et faire agir `handleCadavreAFK` sur `activePlayers[gameState.activeCadavreIndex]` quel que soit l'écrivain (remplacer le test `activeCadavreIndex === 0` par un test sur l'id du joueur courant).

### C4 — Déconnexion en CADAVRE/STORY_VOTE : fonctions inexistantes → ReferenceError + blocage
- **Fichier:ligne** : `app.js:588` (`checkAllCadavreSubmitted()`), `app.js:590` (`checkAllStoryVotesSubmitted()`)
- **Description** : `handlePlayerDisconnect` appelle deux fonctions **jamais définies** dans `app.js` (vérifié par grep). L'exception interrompt la fonction au milieu ; le re-test de déblocage ne s'exécute jamais.
- **Symptôme** : si l'écrivain cadavre courant se déconnecte, l'hôte attend un `SUBMIT_CADAVRE` qui ne viendra jamais → blocage permanent. Idem en STORY_VOTE.
- **Correctif** : définir les deux fonctions (ex. relancer `triggerNextOnlineCadavreTurn()` et la progression de `registerOnlineStoryVote` avec clamp de `currentStoryVoterIdx`) ou garder par `typeof … === 'function'`.

### C5 — Course à t=0 : l'AFK hôte disqualifie les clients auto-soumis + double `VOTE_START`
- **Fichier:ligne** : `app.js:1098-1117` (`startOnlineTimer`), `app.js:1120-1164` (`handleOnlineAFKTimeout`), `app.js:1207-1214` (`syncClientTimer`), `app.js:892` (`registerOnlineProposition`), `app.js:904` (`checkAllInputsSubmitted`)
- **Description** : le commentaire affirme que le client « s'est auto-soumise à l'Hôte il y a 1s », mais le client ne s'auto-soumet qu'à réception du tick `seconds <= 0`. Or l'hôte, dans le **même tick** qui émet `TIMER_TICK(0)`, exécute immédiatement `handleOnlineAFKTimeout()` qui marque tous les non-soumis `active = false` et les KICK. De plus, si un `SUBMIT_PROPOSITION` tardif arrive après le passage en phase VOTE, `registerOnlineProposition` → `checkAllInputsSubmitted` relance `initVotePhase()` une 2e fois.
- **Symptôme** : « j'ai tapé un mot valide mais n'ai pas cliqué Valider dans la dernière seconde → disqualifié » ; ou écrans de vote clients qui se réinitialisent (double `VOTE_START`).
- **Correctif** : après `TIMER_TICK(0)`, différer `handleOnlineAFKTimeout()` d'~1,5 s pour laisser atterrir les auto-soumissions ; et no-op sur `registerOnlineProposition`/`checkAllInputsSubmitted` quand `gameState.gamePhase !== 'INPUT'`.

### C6 — Hôte éliminé pour AFK → verrouillé hors du vote/cadavre, écran figé
- **Fichier:ligne** : `app.js:1152-1154` (`handleOnlineAFKTimeout`), `app.js:1326-1353` (`initVotePhase`), `app.js:1738-1768` (`triggerNextOnlineCadavreTurn`)
- **Description** : si l'entrée de l'hôte est vide/invalide à t=0, l'hôte est marqué inactif, mais `initVotePhase` n'itère que sur `activePlayers` (l'hôte n'obtient ni écran de vote ni `setupOnlineHostVoteUI`), et `triggerNextOnlineCadavreTurn` le saute sans lui envoyer `CADAVRE_START` ni `CADAVRE_WAIT`.
- **Symptôme** : l'hôte voit « 💀 Vous avez été éliminé pour inactivité ! » mais le jeu continue ; son écran reste figé pendant que les clients votent et écrivent le cadavre.
- **Correctif** : soit terminer la partie si l'hôte est éliminé, soit garder l'hôte dans les boucles interactives en spectateur (avec ses propres options visibles).

---

## 🟠 HAUTES

### H1 — `renderScoreboard()` appelé mais jamais défini
- **Fichier:ligne** : appels à `app.js:506`, `app.js:557`, `app.js:1670` ; **aucune définition** dans `app.js` (vérifié par grep)
- **Description** : `showRevealScreen` (app.js:1663-1673) jette `ReferenceError` après `showScreen('reveal')` mais **avant** le démarrage du confetti. Côté client, le handler `REVEAL_WINNER` (app.js:506) avorte et n'exécute ni le masquage du bouton (app.js:509-510) ni le confetti.
- **Symptôme** : scoreboard « Classement Actuel » toujours vide ; pas de confetti sur l'écran de révélation ; chez les clients le bouton « Continuer la partie » reste visible → cliqué, il fait exécuter le flow hôte au client et désynchronise son état.
- **Correctif** : implémenter `renderScoreboard()` (peupler `#scoreboard-list` depuis `gameState.players`, triés par score — s'inspirer de `showFinalPodium` app.js:2443-2456) ; et masquer le bouton avant l'appel / envelopper dans try/catch pour qu'une erreur ne réactive pas l'avancement client.

### H2 — Mots des clients non validés contre le tirage de lettres
- **Fichier:ligne** : `app.js:867-871` (`submitClientSaisie`), `app.js:892-902` (`registerOnlineProposition`), comparer `app.js:929-944` (`validateSaisieInputLocal`)
- **Description** : l'hôte valide son mot contre le rack de 7 lettres ; les clients ne font qu'un regex + longueur minimale, et l'hôte ne re-valide jamais les soumissions client (juste `push`).
- **Symptôme** : un client peut gagner avec « VXYZZQ » utilisant des lettres hors tirage, que l'hôte n'aurait pas pu soumettre.
- **Correctif** : déplacer la validation rack dans `registerOnlineProposition` (ou faire valider le client par le même chemin que l'hôte).

---

## 🟡 MOYENNES

### M1 — Vote local sans timer ni AFK → blocage permanent
- **Fichier:ligne** : `app.js:1317` (`initVotePhase`), `app.js:1512` (`setupLocalVoteUI`), `app.js:1550` (`submitLocalVote`), `app.js:2212` (`renderLocalStoryVoteButtons`)
- **Description** : aucune phase de vote (proposition ou histoire) ne démarre de timer, aucun handler AFK n'existe pour le vote. La spec (§3.2-3.4) impose « Vote (30 secondes) ».
- **Symptôme** : si un joueur abandonne l'écran pendant son tour de vote, la partie attend indéfiniment sur `screen-vote`.
- **Correctif** : ajouter un timer de 30 s (réutiliser le pattern `startTimer`) et à l'expiration sauter/éliminer le votant courant (pattern `handleAFKTimeout`).

### M2 — `handleSaisieKeydown` référencé dans le HTML mais jamais défini
- **Fichier:ligne** : `index.html:209` (`onkeydown="handleSaisieKeydown(event)"`) ; aucune définition dans `app.js`
- **Description** : contrairement aux boutons submit (surchargés en `.onclick` par les setup), l'`onkeydown` de `#saisie-input` n'est jamais réassigné.
- **Symptôme** : chaque touche dans le champ de saisie jette `Uncaught ReferenceError` ; la soumission par Entrée ne fonctionne jamais.
- **Correctif** : définir `handleSaisieKeydown` (ex. `if (event.key === 'Enter') document.getElementById('btn-submit-saisie').click();`) ou retirer l'attribut.

### M3 — Joueurs déconnectés jamais retirés : fantômes, partie à 1 joueur, slots pleins
- **Fichier:ligne** : `app.js:564-595` (`handlePlayerDisconnect` — marque `active=false` sans retirer), `app.js:340-360` (`updateOnlinePlayersDisplay`), `app.js:287` (`registerNewPlayer` — capacité comptée sur `players.length`), `app.js:602-619` (`startOnlineGame`)
- **Description** : le joueur déconnecté reste dans `gameState.players`. `btnStart.disabled = players.length < 2` compte les fantômes ; le plein de salon (`>= 4`) ne se libère jamais ; `startOnlineGame` n'a pas de contrôle d'actifs.
- **Symptôme** : fantôme visible au lobby, bouton démarrer actif pour une partie condamnée (« moins de 2 joueurs actifs »), salon 4/4 plein à jamais après un départ.
- **Correctif** : en phase LOBBY, filtrer `gameState.players = gameState.players.filter(p => p.active || p.id === 0)` dans `handlePlayerDisconnect`, et baser bouton/plein sur `getActivePlayers()`.

### M4 — Timer cadavre client figé à 90 s (mauvais élément mis à jour)
- **Fichier:ligne** : `app.js:1187-1215` (`syncClientTimer` cible `#timer-text`), `app.js:1875-1878` (`setupClientCadavreUI`), `app.js:2077`/`app.js:2085` (ticks hôte)
- **Description** : le timer cadavre de l'hôte diffuse `TIMER_TICK`, mais côté client tous les ticks passent par `syncClientTimer` qui met à jour `#timer-text` (champ de la phase saisie, masqué) et jamais `#cadavre-timer-value`.
- **Symptôme** : l'écrivain voit « Temps restant : 90s » indéfiniment puis est soudain exclu par `handleCadavreAFK` sans avertissement.
- **Correctif** : dans `syncClientTimer`, mettre à jour `#cadavre-timer-value` quand `gameState.gamePhase === 'CADAVRE'`, ou ajouter un handler `CADAVRE_TIMER_TICK` dédié.

### M5 — XSS au reveal d'histoire : texte joueur injecté en `innerHTML` sans échappement
- **Fichier:ligne** : `app.js:2291-2295` (`renderOnlineStoryText`), `app.js:2202` (`initLocalCadavreReveal`)
- **Description** : phrases et définitions (entrées libres des joueurs) interpolées dans `innerHTML` via `data-tooltip="${wordUpper} : ${defText}"` et templates, sans échappement.
- **Symptôme** : un `"` casse l'attribut `data-tooltip` ; du contenu type `</span><img src=x onerror=...>` s'exécute chez chaque client. En réseau, tout participant peut prendre le contrôle des onglets.
- **Correctif** : échapper le HTML des textes/defText interpolés (et la valeur d'attribut), ou construire le surlignage via `document.createElement` + `textContent`.

---

## 🟢 BASSES

- **B1 — Handlers HTML inexistants** : `submitSaisie()` (index.html:215), `submitVote()` (index.html:245), `submitCadavreSentence()` (index.html:314) jamais définis. Inertes en local (toujours surchargés avant clic) mais fenêtre exploitable en ligne au `GAME_START` (app.js:459-463, écran saisi affiché avant le `setupClientSaisieUI`). Correctif : retirer les attributs `onclick` ou définir les stubs.
- **B2 — Globaux implicites** : `currentStoryVoterIdx` (écrit app.js:2184) jamais déclaré ; `card` (app.js:1439, corrigé par C1). Explosent sous `"use strict"`. Correctif : ajouter `let currentStoryVoterIdx = 0;` près de `let selectedVotePlayerId` (app.js:2549).
- **B3 — Texte d'aide vote faux en 2 joueurs** : index.html:244 « Tu ne peux pas voter pour ta propre proposition (elle est grisée). » — faux depuis le commit 5ee1ab4 qui autorise l'auto-vote à 2 joueurs actifs (app.js:1528). Correctif : mettre à jour le texte ou le masquer.
- **B4 — `resetGame` affiche le formulaire hôte aux clients** : app.js:2478-2503 masque/affiche `online-host-setup`/`online-client-setup` sans condition. Un client kické retombe au lobby avec le formulaire « Créer un salon ». Correctif : afficher le panneau selon `onlineRole`.

---

## ✅ VÉRIFIÉ OK (ne pas toucher)

- **Génération du tirage** : `generateLetters` (app.js:2558-2568) garantit ≥2 voyelles (2 ou 3), conforme à la spec.
- **Scoring** : Phase 1 = +50 (app.js:1625), Phase 2 = +100 (app.js:1630), Phase 3 = +150 (app.js:1634), vote d'histoire = +200 (app.js:2399). `SCRABBLE_POINTS` correct (app.js:7-10), utilisé uniquement pour l'affichage du rack.
- **Compteur manche/phase** : app.js:1676-1693 — phase 1→3 dans la manche, manche++, retour à phase 1, dernière manche → `initCadavreExquisPhase`. Header « Manche X/Y » correct.
- **Cycle de vie des timers (local)** : `startTimer`/`startCadavreTimer` font `clearInterval` d'abord ; les soumissions locales clear avant transition ; l'intervalle s'auto-clear à 0. Pas de fuite/intervalle double constatée.
- **Tally des votes (local)** : un vote par votant, `voteCounts[v.targetId]` restreint aux options affichées, égalité → Mort Subite (max 2 re-votes puis aléatoire). Pas de double comptage.
- **Logique AFK** : un joueur éliminé ne laisse jamais de proposition dans le pool (élimination seulement si entrée vide/invalide) → le pool de vote = joueurs actifs, jamais de cible fantôme. Cas « 1 seule proposition valide » → `checkActivePlayersCount()` (app.js:1308) termine proprement si < 2 actifs.
- **Validation saisie (local)** : phase 1 = regex lettres + longueur ≥2 + consommation exacte du rack (app.js:918-945) ; phase 3 = inclusion du mot officiel ; vide/espaces rejetés. `handleAFKTimeout` applique les mêmes contrôles.
- **IDs/classes DOM** : tous les `getElementById` existent dans index.html ; toutes les classes ajoutées/retirées par JS sont définies dans style.css ; `stroke-dasharray: 283` (style.css:647) cohérent avec le JS.
- **Mapping `showScreen`** : les 9 clés correspondent aux sections ; `screen-vote-transition` ↔ `voteTransition` OK.
- **Symétrie des types de messages** : tous les types hôte→client (WELCOME, LOBBY_UPDATE, KICK, GAME_START, PHASE_START, TIMER_TICK, VOTE_START, REVEAL_WINNER, CADAVRE_START, CADAVRE_WAIT, STORY_REVEAL, STORY_VOTE_TICK, GAME_OVER, PLAYER_DISCONNECT) ont un handler correspondant dans `handleClientIncomingMessage` (app.js:437-560) ; tous les types client→hôte (JOIN, SUBMIT_PROPOSITION, SUBMIT_VOTE, SUBMIT_CADAVRE, SUBMIT_STORY_VOTE) sont traités (app.js:267-284, app.js:415-433). `registerOnlineStoryVoteClient` (app.js:2371) est un no-op volontaire.
- **peerId vs playerId** : `peer.id` (« neo-xxxx ») utilisé uniquement comme code de salon ; `playerId` = index entier dans `gameState.players` ; `conn.metadata.playerId` seul transmis à `handleHostIncomingMessage`. Aucune confusion.
- **Idempotence des enregistrements** : `registerOnlineProposition`, `registerOnlineVote`, `registerOnlineCadavre`, `registerOnlineStoryVote` gardent contre les doublons (clics/re-messages) — pas de double comptage.
- **Cycle de vie connexions** : `sendToAll` filtre `conn.open` ; KICK ferme puis supprime via l'événement `close` ; `cleanupNetwork` détruit le peer. Handlers client câblés dans `peer.on('open')`.
- **Gating de phase hôte** : `handleHostIncomingMessage` ignore les messages hors phase courante ; l'hôte n'avance qu'après soumission de tous les actifs (comptage incluant la propre entrée de l'hôte).

---

## Checklist de tests pour la session de correction ultérieure

**Mode Local (1 onglet, 3 joueurs)**
- [ ] Partie complète 3 manches : mot → vote → définition → vote → phrase → vote → cadavre → vote histoire → podium
- [ ] Scoreboard remplit sur l'écran de révélation (H1) ; confetti visible
- [ ] Saisie par Entrée fonctionne (M2)
- [ ] Abandon pendant un vote → avance/élimination après 30 s (M1)
- [ ] Joueur AFK en phase 1 → éliminé ; partie continue ; < 2 actifs → podium
- [ ] Égalité → Mort Subite → second vote → vainqueur
- [ ] Texte d'aide vote cohérent en 2 joueurs (B3)

**Mode En Ligne (2 onglets ou navigateurs : hôte + client)**
- [ ] Client peut voter pour n'importe quelle carte, surbrillance correcte (C1)
- [ ] Vote d'histoire : chaque votant à son tour, tous les clients voient le bon votant actif (C2), podium atteint
- [ ] Client-écrivain au cadavre : compte à rebours visible qui décrémente (M4), auto-soumission à 0 (C3)
- [ ] Client-écrivain AFK → tour sauté/éliminé (C3)
- [ ] Hôte AFK en saisie : pas d'écran figé, hôte en spectateur ou partie terminée (C6)
- [ ] Mot client hors tirage rejeté (H2)
- [ ] Déconnexion d'un client en cadavre/vote → pas de ReferenceError, partie continue (C4)
- [ ] Déconnexion au lobby → plus de fantôme, bouton démarrer reflète les actifs (M3)
- [ ] Client tape un mot valide sans cliquer Valider → auto-soumission à t=0 sans KICK (C5)
- [ ] Pas de double réinitialisation des écrans de vote (double VOTE_START, C5)
- [ ] Client kické → lobby avec formulaire « Rejoindre » et non « Créer » (B4)
- [ ] Entrée avec apostrophes/guillemets/HTML dans le cadavre → reveal intact, rien ne s'exécute (M5)
