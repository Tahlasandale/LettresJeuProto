# 👑 NÉOLOGIX — Le Jeu des Mots Inventés

![NÉOLOGIX Logo](logo-full.png)

**Néologix** est un jeu de société numérique rapide, créatif et drôle (Party Game) basé sur la création de néologismes. 

À partir d'un même tirage aléatoire de 7 lettres de Scrabble, les joueurs doivent inventer un mot, lui trouver une définition, l'utiliser dans une phrase d'exemple, puis fusionner leurs créations dans un cadavre exquis littéraire. L'humour, la mauvaise foi et la créativité sont au cœur de l'expérience, départagés par des votes anonymes.

La particularité de cette implémentation est son architecture **hybride** : elle permet de jouer soit en **Local (Pass & Play)** sur un seul écran, soit **En ligne (Multi-appareils)** en Peer-to-Peer direct sans base de données.

---

## 🎮 Modes de Jeu

### 1. Local (Pass & Play)
- Se joue sur **un seul écran** (ordinateur, tablette ou smartphone) partagé entre les joueurs.
- Des écrans de transition secrets masquent temporairement l'affichage pour permettre à chaque joueur de saisir sa réponse ou d'effectuer son vote en secret sans que ses voisins ne regardent.

### 2. En Ligne (Réseau P2P)
- Chaque joueur utilise **son propre appareil** (PC ou mobile).
- **Hôte (MJ)** : Il crée le salon. Son navigateur gère l'état de la partie, le chronomètre officiel, les tirages et le dépouillement des votes. Il génère un code unique de salon (ex: `NEO-4829`).
- **Clients (Joueurs)** : Ils rejoignent le salon en saisissant le code. Leurs navigateurs affichent les consignes et envoient les saisies et votes directement à l'Hôte en temps réel via des connexions directes **WebRTC**.
- Les phases de saisie et de vote s'effectuent **simultanément** pour tous les joueurs, accélérant grandement le rythme de la partie.

---

## 🔄 La Boucle de Jeu (Game Loop)

Chaque partie se déroule en plusieurs manches configurables (par défaut 2), chacune divisée en 3 phases de création suivies d'une phase finale narrative.

### 📝 Phase 1 : Le Mot
- **Saisie** : Le système génère un tirage de 7 lettres (contenant au moins 2 voyelles pour assurer la prononçabilité). Chaque joueur invente un mot à l'aide de ces lettres (durée : 30s).
- **Vérification** : Un algorithme vérifie que le mot saisi ne contient **que** les lettres du tirage de la manche.
- **Vote** : Les propositions sont mélangées anonymement. Chaque joueur vote pour le mot le plus convaincant. Le mot gagnant devient le mot officiel de la manche. *(Récompense : +50 pts)*.

### 📖 Phase 2 : La Définition
- **Saisie** : À partir du mot gagnant de la Phase 1, chaque joueur rédige une définition drôle ou convaincante (durée : 90s).
- **Vote** : Vote anonyme pour la meilleure définition, qui est alors verrouillée. *(Récompense : +100 pts)*.

### 💬 Phase 3 : La Phrase
- **Saisie** : Les joueurs doivent inventer une phrase d'exemple intégrant obligatoirement le mot gagnant et sa définition officielle (durée : 90s).
- **Vote** : Vote anonyme pour la meilleure phrase de mise en situation. *(Récompense : +150 pts)*.

### ✍️ Phase Finale : Le Cadavre Exquis
- Tous les néologismes créés durant la partie sont rassemblés.
- Tour à tour, chaque joueur ajoute une phrase à une histoire commune.
- **Pass-and-play / Tour par tour** : Pour conserver l'effet de surprise, chaque joueur ne voit que les 25 derniers caractères de la phrase précédente.
- **Contrainte** : La phrase du joueur doit obligatoirement utiliser l'un des néologismes créés dans la partie.
- **Révélation** : L'histoire complète est révélée à l'écran. Les mots inventés sont surlignés et leur définition s'affiche au survol (Tooltip).
- **Vote de la Plume d'Or** : Un vote final désigne le meilleur écrivain de l'histoire. *(Récompense : +200 pts)*.

---

## ⚙️ Règles Spéciales & Système AFK

### ⚡ Mort Subite (Gestion des égalités)
Si deux propositions ou plus arrivent à égalité lors d'un vote, une manche de *Mort Subite* s'enclenche instantanément. Seuls les choix à égalité sont proposés au vote. Si une égalité persiste après deux revotes consécutifs, le destin tranche au hasard afin de ne pas bloquer la partie.

### ⏳ Gestion de l'inactivité (AFK)
Si le chronomètre de saisie (30s ou 90s) arrive à zéro :
- **Saisie en cours** : Si le joueur a déjà écrit du texte et que celui-ci respecte les consignes (lettres valides / mot inclus), sa saisie est **validée et soumise automatiquement**.
- **Inactivité totale** : Si le champ est vide ou invalide, le joueur est maudit et immédiatement **éjecté de la partie**. Les seuils de votes et les tours sont recalculés en temps réel.

### 🗳️ Exception de vote à 2 joueurs
Afin d'éviter le blocage systématique lors des votes à 2 joueurs actifs (où chacun voterait pour la proposition de l'autre), la restriction d'auto-vote est levée. Les joueurs sont autorisés à voter pour leur propre proposition si la partie ne comporte plus que 2 joueurs actifs.

---

## 🛠️ Stack Technique

- **Structure** : HTML5 sémantique.
- **Design** : CSS3 Vanilla (Responsive mobile-first, Glassmorphism, animations et dégradés néon).
- **Logique** : Vanilla ES6+ Javascript.
- **Réseau P2P** : [PeerJS](https://peerjs.com/) (WebRTC) via CDN public.
- **Hébergement** : Déploiement statique sur [Vercel](https://lettres-jeu-proto.vercel.app).

---

## 🚀 Installation & Lancement en local

Puisque l'application est entièrement statique, aucun serveur Node.js ou base de données n'est requis en local.

1. Clonez le dépôt :
   ```bash
   git clone https://github.com/Tahlasandale/LettresJeuProto.git
   ```
2. Ouvrez simplement le fichier `index.html` dans votre navigateur ou lancez un serveur HTTP local léger :
   ```bash
   # Avec Python
   python3 -m http.server 8080
   
   # Ou avec Node.js
   npx http-server -p 8080
   ```
3. Accédez à l'application sur `http://localhost:8080`.
