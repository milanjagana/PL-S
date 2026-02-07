/* =========================
   DOM
========================= */
const setupScreen = document.getElementById("setup");
const playScreen = document.getElementById("play");

const setupForm = document.getElementById("setupForm");
const btnAddPlayer = document.getElementById("btnAddPlayer");
const btnValidate = document.getElementById("btnValidate");

const pileEl = document.getElementById("pile");
const hudPlayer = document.getElementById("hudPlayer");
const hudSips = document.getElementById("hudSips");

const controlsDefault = document.getElementById("controlsDefault");
const panel = document.getElementById("panel");

const popup = document.getElementById("popup");
const popupText = document.getElementById("popupText");
const popupClose = document.getElementById("popupClose");

const body = document.body;

/* =========================
   ASSETS (identiques V1)
========================= */
const DOS = {
  chiffre: "assets/cartes/dos/dos-noir.png",
  speciale: "assets/cartes/dos/dos-rose.png",
  regle: "assets/cartes/dos/dos-regle.png"
};

/* =========================
   HELPERS
========================= */
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function randomRotation() {
  // [-8;-4] U [4;8]
  const sign = Math.random() < 0.5 ? -1 : 1;
  const value = Math.random() * 4 + 4; // 4..8
  return +(sign * value).toFixed(2);
}

function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[s]));
}

function showPopup(html){
  popupText.innerHTML = html;
  popup.classList.remove("hidden");
}
function hidePopup(){
  popup.classList.add("hidden");
  popupText.innerHTML = "";
}
popupClose.addEventListener("click", hidePopup);
popup.addEventListener("click", (e)=>{ if(e.target === popup) hidePopup(); });

/* =========================
   DATA: cartes
   - Version numérique: pioche infinie, cartes chiffres sortent ~4x plus
========================= */
const couleurs = ["vert", "orange"];

function makeChiffreCarte(value, couleur){
  return {
    type: "chiffre",
    valeur: value,
    couleur,
    image: `assets/cartes/chiffres/chiffre-${value}-${couleur}.png`,
    dos: DOS.chiffre,
    rotation: randomRotation()
  };
}

const specialNames = [
  "mytho",
  "doubledose",
  "unpetitdernier?",
  "tourneegenerale",   // ATTENTION orthographe demandée
  "pl(s)",
  "visiontrouble",
  "cestlescopains!",
  "analyse",
  "pilierdecomptoir",
  "pressionsociale",
  "cestcadeau",
  "lapetitesoeur",
  "balleneuve"
];

function makeSpecialeCarte(nom){
  return {
    type: "speciale",
    nom,
    image: `assets/cartes/speciales/speciale-${nom}.png`,
    dos: DOS.speciale,
    rotation: randomRotation()
  };
}

const regles = ["1","2","3","4"].map((id, idx)=>({
  type: "regle",
  nom: id,
  image: `assets/cartes/regles/regle-${id}.png`,
  dos: DOS.regle,
  rotation: 0,
  ordre: idx
}));

/* =========================
   GAME STATE
========================= */
let joueurs = [];
let joueurIndex = 0;

let compteur = 0;                 // gorgées accumulées
let hasWonThisTurn = false;       // pour autoriser "fin de tour"

let pile = [];                    // 5 cartes visibles (0 = active/face up)
let animating = false;

let piocheInitiale = [];          // règles au-dessus au début

// effets persistants "jusqu'à ce que quelqu'un boive"
let mythoActive = false;          // inverse vrai/faux jusqu'à reset compteur (perte)
let doubleDoseActive = false;     // double les gorgées quand quelqu'un boit jusqu'à prochaine perte

// “Un petit dernier ?”
let nextTurnConstraint = null;    // {playerIndex, remainingWins:2, satisfied:false}
let lastTNPlayerIndex = null;     // “dernier à avoir TN..” (approx)

// “C’est cadeau”
let cadeauActive = null;          // {forPlayerIndex: X, chooserPlayerIndex: Y} (pour le prochain guess du joueur courant)

// “Copains” (partage)
let copainsActive = null;         // {forPlayerIndex, selectedIndices: []}

// “Pilier”
let pilierActive = null;          // {forPlayerIndex, otherIndex}

// “Petite soeur”
let petiteSoeurActive = null;     // {forPlayerIndex:true}

// mode d’UI spéciale en cours
let uiMode = "default";           // default | pls_value | vision | copains | pilier | analyse | cadeau_choose
let pending = null;               // stockage temporaire selon mode

/* =========================
   SETUP UI
========================= */
function renderSetupInputs(count){
  setupForm.innerHTML = "";
  for(let i=1;i<=count;i++){
    const input = document.createElement("input");
    input.className = "player-input";
    input.placeholder = `Nom du joueur ${i}…`;
    input.dataset.idx = String(i-1);
    setupForm.appendChild(input);
  }
}

let setupCount = 1;
renderSetupInputs(setupCount);

btnAddPlayer.addEventListener("click", ()=>{
  setupCount += 1;
  renderSetupInputs(setupCount);
});

btnValidate.addEventListener("click", ()=>{
  const inputs = [...setupForm.querySelectorAll("input")];
  const names = inputs.map(i => i.value.trim()).filter(Boolean);

  if(names.length < 2){
    showPopup(`<span class="pink">Il faut au moins 2 joueurs.</span>`);
    return;
  }
  joueurs = names;
  joueurIndex = 0;
  startGame();
});

/* =========================
   PIOCHE INFINIE + CONTRAINTES
   - Règles uniquement au tout début (piocheInitiale)
   - Première carte non-règle forcée chiffre
   - Deux spéciales ne peuvent pas se suivre
   - Pondération: chiffres ~4x plus probables
========================= */
let lastGeneratedWasSpecial = false;
let firstNonRuleForced = true;

function resetDeckLogic(){
  piocheInitiale = [...regles]; // dans l’ordre
  lastGeneratedWasSpecial = false;
  firstNonRuleForced = true;
}

function drawFromInitial(){
  if(piocheInitiale.length > 0) return piocheInitiale.shift();
  return null;
}

function drawInfinite(){
  // force tout premier non-règle = chiffre
  if(firstNonRuleForced){
    firstNonRuleForced = false;
    const v = Math.floor(Math.random()*10);
    const c = couleurs[Math.floor(Math.random()*couleurs.length)];
    lastGeneratedWasSpecial = false;
    return makeChiffreCarte(v,c);
  }

  // si la précédente générée était spéciale => forcer chiffre
  if(lastGeneratedWasSpecial){
    const v = Math.floor(Math.random()*10);
    const c = couleurs[Math.floor(Math.random()*couleurs.length)];
    lastGeneratedWasSpecial = false;
    return makeChiffreCarte(v,c);
  }

  // pondération 4:1 (chiffre:speciale)
  const roll = Math.random();
  if(roll < 0.80){ // ~80% chiffre
    const v = Math.floor(Math.random()*10);
    const c = couleurs[Math.floor(Math.random()*couleurs.length)];
    lastGeneratedWasSpecial = false;
    return makeChiffreCarte(v,c);
  }else{
    const nom = specialNames[Math.floor(Math.random()*specialNames.length)];
    lastGeneratedWasSpecial = true;
    return makeSpecialeCarte(nom);
  }
}

function tirerCarte(){
  const init = drawFromInitial();
  if(init) return init;
  return drawInfinite();
}

/* =========================
   INITIALISATION PARTIE
========================= */
function startGame(){
  // reset états
  compteur = 0;
  hasWonThisTurn = false;

  mythoActive = false;
  doubleDoseActive = false;

  nextTurnConstraint = null;
  lastTNPlayerIndex = null;

  cadeauActive = null;
  copainsActive = null;
  pilierActive = null;
  petiteSoeurActive = null;

  uiMode = "default";
  pending = null;

  resetDeckLogic();
  initPileAndLaunch();

  setupScreen.classList.remove("active");
  playScreen.classList.add("active");
}

async function initPileAndLaunch(){
  animating = true;
  body.classList.remove("special-bg","reset-bg");

  pile = [];
  pileEl.innerHTML = "";

  // prépare les 5 premières (4 règles + 1 chiffre)
  const firstFive = [];
  for(let i=0;i<4;i++) firstFive.push(tirerCarte());
  firstFive.push(tirerCarte()); // chiffre forcé par logique

  // distribution "une par une par le haut"
  for(let i=0;i<5;i++){
    pile.push(firstFive[i]);
    renderPile(true); // render partiel
    await sleep(120);

    // petit effet "deal"
    const card = pileEl.querySelector(`.card[data-idx="${i}"]`);
    if(card){
      card.classList.add("enter-left");
      await sleep(80);
      card.classList.remove("enter-left");
    }
  }

  // compléter pour rester à 5 visibles (déjà 5)
  renderPile(false);

  // flip de la première carte (active)
  await sleep(60);
  flipActiveAndApplyHalo();

  animating = false;
  updateHUD();
  updateActionsAvailability();
}

/* =========================
   RENDU PILE
========================= */
function renderPile(isDealing){
  pileEl.innerHTML = "";

  const visible = pile.slice(0,5);

  visible.forEach((carte, index) => {
    const card = document.createElement("div");
    card.classList.add("card");
    card.dataset.idx = String(index);

    // transform pour pile
    if(index === 0){
      card.classList.add("active");
      // rotation nulle pour la carte du dessus
      card.style.transform = `translate(-50%, -50%)`;
    }else{
      card.classList.add(`stack-${index}`);
      const rot = carte.rotation ?? randomRotation();
      const y = index * 14;
      card.style.transform = `translate(-50%, -50%) rotate(${rot}deg) translateY(${y}px)`;
    }

    const back = document.createElement("div");
    back.classList.add("card-face", "card-back");
    back.style.backgroundImage = `url("${carte.dos}")`;

    const front = document.createElement("div");
    front.classList.add("card-face", "card-front");
    front.style.backgroundImage = `url("${carte.image}")`;

    card.appendChild(back);
    card.appendChild(front);
    pileEl.appendChild(card);

    // au deal, on ne flip pas immédiatement
    if(!isDealing && index === 0){
      // flip géré par flipActiveAndApplyHalo()
      // on laisse tel quel ici
    }
  });
}

function flipActiveAndApplyHalo(){
  const active = pileEl.querySelector(".card.active");
  if(!active) return;

  // flip
  active.classList.add("flipped");

  const top = pile[0];
  // halo rose si carte spéciale (sauf balleneuve)
  if(top && top.type === "speciale" && top.nom !== "balleneuve"){
    body.classList.remove("reset-bg");
    body.classList.add("special-bg");
  }
}

/* =========================
   NAVIGATION TOUR / HUD
========================= */
function currentPlayerName(){
  return joueurs[joueurIndex] ?? "Joueur";
}
function nextPlayerIndex(){
  return (joueurIndex + 1) % joueurs.length;
}
function setPlayer(idx){
  joueurIndex = (idx + joueurs.length) % joueurs.length;
  hasWonThisTurn = false;
  updateHUD();
  applyNextTurnConstraintIfNeeded();
  updateActionsAvailability();
}

function updateHUD(){
  hudPlayer.textContent = currentPlayerName();
  hudSips.textContent = String(compteur);
}

function applyNextTurnConstraintIfNeeded(){
  if(nextTurnConstraint && nextTurnConstraint.playerIndex === joueurIndex && !nextTurnConstraint.satisfied){
    // le joueur doit faire 2 wins consécutifs ou tenter purple
  }
}

/* =========================
   BOUTONS DEFAULT
========================= */
controlsDefault.addEventListener("click", (e)=>{
  const btn = e.target.closest("button");
  if(!btn) return;
  const action = btn.dataset.action;
  if(!action) return;

  if(btn.disabled) return;

  if(action === "fin"){
    attemptEndTurn();
    return;
  }

  handleGuessAction(action);
});

/* =========================
   DISPONIBILITÉS ACTIONS
========================= */
function setButtonState(action, enabled){
  const btn = controlsDefault.querySelector(`.btn-action[data-action="${action}"]`);
  if(!btn) return;
  btn.disabled = !enabled;
  btn.classList.toggle("disabled", !enabled);
}

function updateActionsAvailability(){
  if(uiMode !== "default"){
    // en UI spéciale, on cache grille
    controlsDefault.style.display = "none";
    return;
  }
  controlsDefault.style.display = "grid";
  panel.classList.add("hidden");
  panel.innerHTML = "";

  const top = pile[0];

  // par défaut
  ["plus","moins","orange","vert","purple","fin"].forEach(a => setButtonState(a, true));

  // fin de tour: seulement si au moins un guess gagné dans ce tour
  // + pas autorisé si contrainte TN active non satisfaite
  let canEnd = hasWonThisTurn;

  if(nextTurnConstraint && nextTurnConstraint.playerIndex === joueurIndex && !nextTurnConstraint.satisfied){
    canEnd = false;
  }
  setButtonState("fin", canEnd);

  // si top carte règle ou spéciale => pas le droit Plus/Moins
  if(!top || top.type !== "chiffre"){
    setButtonState("plus", false);
    setButtonState("moins", false);
  }

  // Purple seulement si les 2 prochaines cartes sont chiffres
  const c1 = pile[1];
  const c2 = pile[2];
  const purpleOK = (c1 && c2 && c1.type === "chiffre" && c2.type === "chiffre");
  setButtonState("purple", purpleOK);

  // si top carte règle/special => on peut quand même Orange/Vert (règle autorise)
  // MAIS ton texte dit: si carte précédente est règle (tout premier guess) OU spéciale,
  // pas le droit Plus/Moins (déjà géré). Orange/Vert restent OK.
}

/* =========================
   FLUX PRINCIPAL: faire un guess
========================= */
async function handleGuessAction(action){
  if(animating) return;

  // Si carte spéciale en haut => on n’accepte pas un guess "normal"
  const top = pile[0];
  if(!top) return;

  // “C’est cadeau” : le prochain joueur choisit à ta place
  if(cadeauActive && cadeauActive.forPlayerIndex === joueurIndex){
    // on ignore le clic du joueur courant, on force UI où le prochain joueur choisit
    await startCadeauChooser();
    return;
  }

  if(action === "purple"){
    await resolvePurple();
    return;
  }

  if(action === "orange" || action === "vert"){
    await resolveColorGuess(action);
    return;
  }

  if(action === "plus" || action === "moins"){
    await resolvePlusMoins(action);
    return;
  }
}

/* =========================
   ANIM + SHIFT PILE (1 carte)
========================= */
async function advanceOneCard(){
  animating = true;

  // si halo actif, disparition ext->centre
  if(body.classList.contains("special-bg")){
    body.classList.remove("special-bg");
    body.classList.add("reset-bg");
    setTimeout(()=> body.classList.remove("reset-bg"), 450);
  }

  const activeEl = pileEl.querySelector(".card.active");
  if(activeEl){
    activeEl.classList.add("tap");
    setTimeout(()=> activeEl.classList.remove("tap"), 120);

    activeEl.classList.add("exit-right");
  }

  await sleep(450);

  // shift pile + nouvelle carte en bas
  pile.shift();
  pile.push(tirerCarte());

  renderPile(false);

  // flip nouvelle active
  await sleep(60);
  flipActiveAndApplyHalo();

  animating = false;

  // si nouvelle carte est spéciale => appliquer effet tout de suite
  await onCardRevealed();
  updateHUD();
  updateActionsAvailability();
}

/* =========================
   ANIM + SHIFT PILE (2 cartes) pour Purple/Analyse
   - montre 2 cartes 3s puis conserve la 2e comme actuelle
========================= */
async function advanceTwoCardsAndKeepSecond(){
  animating = true;

  if(body.classList.contains("special-bg")){
    body.classList.remove("special-bg");
    body.classList.add("reset-bg");
    setTimeout(()=> body.classList.remove("reset-bg"), 450);
  }

  const activeEl = pileEl.querySelector(".card.active");
  if(activeEl) activeEl.classList.add("exit-right");

  await sleep(450);

  // On retire 1 carte (active) puis 2 cartes retournées (c1,c2) seront visibles
  const first = pile[1];
  const second = pile[2];

  // Nouvelle pile: on supprime active + first, et on garde second en haut
  // pile = [second, ...rest]
  const rest = pile.slice(3);
  pile = [second, ...rest];

  // Remplir jusqu'à 5 visibles
  while(pile.length < 5){
    pile.push(tirerCarte());
  }

  renderPile(false);
  await sleep(60);

  // flip active (second)
  flipActiveAndApplyHalo();

  animating = false;

  // appliquer effet si spéciale
  await onCardRevealed();
  updateHUD();
  updateActionsAvailability();
}

/* =========================
   LOGIQUE GUESS: Plus/Moins
========================= */
async function resolvePlusMoins(dir){
  const top = pile[0];
  const next = pile[1];
  if(!top || !next) return;

  // si top pas chiffre => interdit
  if(top.type !== "chiffre"){
    return;
  }

  // Si next est spéciale ou règle, ce guess devient automatiquement faux (car tu compares une valeur absente)
  // => dans ton cahier des charges, on veut surtout que le jeu reste fluide :
  // on considère que Plus/Moins ne devrait pas être cliquable si top pas chiffre.
  // Mais next peut quand même être spéciale si générée; dans ce cas le guess est perdu.
  let win = false;

  if(next.type === "chiffre"){
    if(dir === "plus") win = next.valeur > top.valeur;
    if(dir === "moins") win = next.valeur < top.valeur;
  }else{
    win = false;
  }

  // mytho inverse
  if(mythoActive) win = !win;

  if(win){
    onWin(1);
    await advanceOneCard();
  }else{
    await onLoseFlow({reason: "guess"});
    // le tour se termine => on révèle quand même la carte suivante visuellement
    await advanceOneCard();
    endTurnToNextPlayer();
  }
}

/* =========================
   LOGIQUE GUESS: Couleur
========================= */
async function resolveColorGuess(color){
  const next = pile[1];
  if(!next) return;

  let win = false;
  if(next.type === "chiffre"){
    win = (next.couleur === color);
  }else{
    // une spéciale n’est ni vert ni orange => faux
    win = false;
  }

  if(mythoActive) win = !win;

  if(win){
    onWin(1);
    await advanceOneCard();
  }else{
    await onLoseFlow({reason: "guess"});
    await advanceOneCard();
    endTurnToNextPlayer();
  }
}

/* =========================
   LOGIQUE GUESS: Purple
========================= */
async function resolvePurple(){
  const c1 = pile[1];
  const c2 = pile[2];
  if(!c1 || !c2) return;

  // purple seulement si 2 chiffres
  if(c1.type !== "chiffre" || c2.type !== "chiffre") return;

  const diff = (c1.couleur !== c2.couleur);
  let win = diff;

  if(mythoActive) win = !win;

  // montrer 2 cartes 3 secondes:
  // on révèle carte 1 puis carte 2 en avançant 2 cartes mais on “garde” la 2e
  if(win){
    onWin(2);
    // petit délai "visible 3s" simulé: on avance visuellement et on attend
    await advanceOneCard();      // révèle c1 comme active
    await sleep(3000);
    // puis on passe à c2 comme active, sans re-compter
    await advanceOneCard();      // révèle c2 comme active
  }else{
    await onLoseFlow({reason: "purple"});
    // on avance quand même (2 cartes visibles 3s puis c2 devient active)
    await advanceOneCard();      // révèle c1
    await sleep(3000);
    await advanceOneCard();      // révèle c2
    endTurnToNextPlayer();
  }

  // satisfaire la contrainte TN si le joueur a "tenté un purple"
  if(nextTurnConstraint && nextTurnConstraint.playerIndex === joueurIndex && !nextTurnConstraint.satisfied){
    nextTurnConstraint.satisfied = true;
  }
}

/* =========================
   COMPTEUR / GAIN / PERTE
========================= */
function onWin(add){
  compteur += add;
  hasWonThisTurn = true;

  // contrainte TN: 2 wins consécutifs
  if(nextTurnConstraint && nextTurnConstraint.playerIndex === joueurIndex && !nextTurnConstraint.satisfied){
    nextTurnConstraint.remainingWins -= 1;
    if(nextTurnConstraint.remainingWins <= 0){
      nextTurnConstraint.satisfied = true;
    }
  }

  updateHUD();
}

async function onLoseFlow({reason}){
  // la perte fait boire compteur (avec effets)
  const amountBase = compteur;
  const amount = doubleDoseActive ? (amountBase * 2) : amountBase;

  // Qui boit ?
  let drinkers = [joueurIndex];

  // Pilier
  if(pilierActive && pilierActive.forPlayerIndex === joueurIndex){
    drinkers = Array.from(new Set([joueurIndex, pilierActive.otherIndex]));
  }

  // Copains
  if(copainsActive && copainsActive.forPlayerIndex === joueurIndex){
    const selected = copainsActive.selectedIndices;
    if(selected.length > 0){
      const group = [joueurIndex, ...selected];
      const per = Math.ceil(amount / group.length);

      // reste au dernier TN (approx) si pas divisible
      const total = per * group.length;
      const extra = total - amount;
      if(extra > 0){
        // on “retire” l’extra à tous en l’ajoutant au TN (approx)
        // => simplification: message indique juste “partagé”
      }

      const names = group.map(i => joueurs[i]);
      showPopup(`${names.map(n=>`<span class="pink">${escapeHtml(n)}</span>`).join(", ")} boivent <span class="pink">${per}</span> gorgées. Plastiquement vôtre !`);
    }else{
      // personne choisi => boit seul
      const name = joueurs[joueurIndex];
      showPopup(`<span class="pink">${escapeHtml(name)}</span> boit <span class="pink">${amount}</span> gorgées. Plastiquement vôtre !`);
    }
  }else{
    // normal
    const names = drinkers.map(i => joueurs[i]);
    showPopup(`${names.map(n=>`<span class="pink">${escapeHtml(n)}</span>`).join(", ")} boivent <span class="pink">${amount}</span> gorgées. Plastiquement vôtre !`);
  }

  // reset compteur + états “jusqu’à ce que quelqu’un boive”
  compteur = 0;
  mythoActive = false;
  doubleDoseActive = false;

  // reset effets “one-shot”
  copainsActive = null;
  pilierActive = null;
  petiteSoeurActive = null; // consommé uniquement si on perd (géré séparément plus bas)
  cadeauActive = null;

  hasWonThisTurn = false;

  updateHUD();
}

/* =========================
   FIN DE TOUR
========================= */
function attemptEndTurn(){
  if(!hasWonThisTurn) return;

  if(nextTurnConstraint && nextTurnConstraint.playerIndex === joueurIndex && !nextTurnConstraint.satisfied){
    return;
  }

  // conserve compteur, passe au suivant
  endTurnToNextPlayer();
}

function endTurnToNextPlayer(){
  const next = nextPlayerIndex();
  setPlayer(next);
}

/* =========================
   QUAND UNE CARTE EST RÉVÉLÉE
   - si spéciale: applique effet & adapte interface
========================= */
async function onCardRevealed(){
  const top = pile[0];
  if(!top) return;

  // règles: aucun effet logique, juste affichées (elles ne reviennent plus)
  if(top.type === "regle"){
    return;
  }

  // chiffres: rien à faire
  if(top.type === "chiffre"){
    return;
  }

  // spéciale
  const nom = top.nom;

  // Pression sociale (pas en numérique)
  if(nom === "pressionsociale"){
    showPopup(`Carte <span class="pink">Pression sociale</span> : votez à l’oral pour choisir le prochain guess.`);
    return;
  }

  if(nom === "mytho"){
    mythoActive = true;
    showPopup(`Carte <span class="pink">Mytho</span> : jusqu’à ce que quelqu’un boive, <span class="pink">vrai</span> et <span class="pink">faux</span> sont inversés.`);
    return;
  }

  if(nom === "doubledose"){
    doubleDoseActive = true;
    showPopup(`Carte <span class="pink">Double dose</span> : jusqu’à ce que quelqu’un boive, chaque gorgée compte <span class="pink">double</span>.`);
    return;
  }

  if(nom === "unpetitdernier?"){
    // contrainte sur le prochain joueur
    const next = nextPlayerIndex();
    nextTurnConstraint = { playerIndex: next, remainingWins: 2, satisfied: false };
    lastTNPlayerIndex = joueurIndex; // approx
    showPopup(`Carte <span class="pink">Un petit dernier ?</span> : au prochain tour, <span class="pink">${escapeHtml(joueurs[next])}</span> doit faire <span class="pink">2 guess</span> consécutifs OU tenter un <span class="pink">Purple</span>.`);
    return;
  }

  if(nom === "tourneegenerale"){
    // reset compteur + fin de tour
    compteur = 0;
    mythoActive = false;
    doubleDoseActive = false;
    hasWonThisTurn = false;

    const names = joueurs.map(n=>`<span class="pink">${escapeHtml(n)}</span>`).join(", ");
    showPopup(`Carte <span class="pink">Tournée générale</span> : ${names} boivent <span class="pink">1</span> gorgée. Plastiquement vôtre !`);

    endTurnToNextPlayer();
    updateHUD();
    return;
  }

  if(nom === "balleneuve"){
    // finit son verre + tour fini + compteur reset
    const p = currentPlayerName();
    compteur = 0;
    mythoActive = false;
    doubleDoseActive = false;
    hasWonThisTurn = false;

    showPopup(`<span class="pink">${escapeHtml(p)}</span> finit <span class="pink">son verre</span>. Plastiquement vôtre !`);
    endTurnToNextPlayer();
    updateHUD();
    return;
  }

  if(nom === "pl(s)"){
    startPLSMode();
    return;
  }

  if(nom === "visiontrouble"){
    startVisionTroubleMode();
    return;
  }

  if(nom === "cestlescopains!"){
    startCopainsMode();
    return;
  }

  if(nom === "pilierdecomptoir"){
    startPilierMode();
    return;
  }

  if(nom === "analyse"){
    startAnalyseMode();
    return;
  }

  if(nom === "cestcadeau"){
    // prochain joueur choisit le prochain guess du joueur actuel
    cadeauActive = { forPlayerIndex: joueurIndex, chooserPlayerIndex: nextPlayerIndex() };
    showPopup(`Carte <span class="pink">C’est cadeau</span> : <span class="pink">${escapeHtml(joueurs[cadeauActive.chooserPlayerIndex])}</span> choisit ton prochain guess. Si c’est faux, <span class="pink">tu bois</span>.`);
    return;
  }

  if(nom === "lapetitesoeur"){
    petiteSoeurActive = { forPlayerIndex: joueurIndex };
    showPopup(`Carte <span class="pink">La petite soeur</span> : si tu perds au prochain guess, tu peux tenter un <span class="pink">Purple</span> pour t’en sortir. Échec = <span class="pink">double</span>.`);
    return;
  }
}

/* =========================
   UI SPÉCIALES
========================= */
function switchToPanel(){
  controlsDefault.style.display = "none";
  panel.classList.remove("hidden");
  panel.innerHTML = "";
}

function backToDefaultUI(){
  uiMode = "default";
  pending = null;
  panel.classList.add("hidden");
  panel.innerHTML = "";
  controlsDefault.style.display = "grid";
  updateActionsAvailability();
}

/* ---- PL(S): choisir valeur exacte 0..9 ---- */
function startPLSMode(){
  uiMode = "pls_value";
  pending = { value: null };
  switchToPanel();

  const wrap = document.createElement("div");
  wrap.className = "panel-wrap";

  const grid = document.createElement("div");
  grid.className = "panel-grid";

  for(let i=0;i<=9;i++){
    const b = document.createElement("button");
    b.className = "btn-action";
    b.textContent = String(i);
    b.addEventListener("click", ()=>{
      pending.value = i;
      [...grid.querySelectorAll("button")].forEach(x=> x.classList.remove("armed"));
      b.classList.add("armed");
      b.dataset.color = "white";
    });
    grid.appendChild(b);
  }

  const validate = document.createElement("button");
  validate.className = "btn-action armed";
  validate.dataset.color = "white";
  validate.textContent = "Valider";
  validate.addEventListener("click", async ()=>{
    if(pending.value === null) return;

    // on révèle la prochaine carte
    const next = pile[1];
    await advanceOneCard();

    // la carte révélée devient pile[0] => c'est l'ancienne "next"
    const revealed = pile[0];

    if(revealed.type === "chiffre" && revealed.valeur === pending.value){
      const others = joueurs.filter((_,i)=> i !== joueurIndex)
        .map(n=>`<span class="pink">${escapeHtml(n)}</span>`).join(", ");
      showPopup(`${others} finissent <span class="pink">leur verre</span> (sauf toi). Plastiquement vôtre !`);
    }else{
      showPopup(`<span class="pink">${escapeHtml(currentPlayerName())}</span> finit <span class="pink">son verre</span>. Plastiquement vôtre !`);
    }

    backToDefaultUI();
  });

  wrap.appendChild(grid);
  wrap.appendChild(validate);
  panel.appendChild(wrap);
}

/* ---- Vision trouble: choisir couleur + plus/moins puis Valider ---- */
function startVisionTroubleMode(){
  uiMode = "vision";
  pending = { color: null, pm: null };
  switchToPanel();

  const wrap = document.createElement("div");
  wrap.className = "panel-wrap";

  const row1 = document.createElement("div");
  row1.className = "panel-row";

  const bPlus = mkSelectBtn("Plus", "white", ()=> pending.pm = "plus", ()=> pending.pm === "plus");
  const bMoins = mkSelectBtn("Moins", "white", ()=> pending.pm = "moins", ()=> pending.pm === "moins");
  row1.appendChild(bPlus); row1.appendChild(bMoins);

  const row2 = document.createElement("div");
  row2.className = "panel-row";

  const bOrange = mkSelectBtn("Orange", "orange", ()=> pending.color = "orange", ()=> pending.color === "orange");
  const bVert = mkSelectBtn("Vert", "vert", ()=> pending.color = "vert", ()=> pending.color === "vert");
  row2.appendChild(bOrange); row2.appendChild(bVert);

  const validate = document.createElement("button");
  validate.className = "btn-action disabled";
  validate.textContent = "Valider";
  validate.disabled = true;

  function refresh(){
    // recolor selected
    [bPlus,bMoins,bOrange,bVert].forEach(b=>{
      b.classList.toggle("armed", b._isSelected());
      if(b._isSelected()){
        b.dataset.color = b._color;
        b.style.color = "#000";
      }else{
        b.dataset.color = "";
        b.style.color = "";
      }
    });

    const ok = pending.pm && pending.color;
    validate.disabled = !ok;
    validate.classList.toggle("disabled", !ok);
    if(ok){
      validate.classList.add("armed");
      validate.dataset.color = "white";
    }else{
      validate.classList.remove("armed");
      validate.dataset.color = "";
    }
  }

  [bPlus,bMoins,bOrange,bVert].forEach(b=> b.addEventListener("click", refresh));
  refresh();

  validate.addEventListener("click", async ()=>{
    if(!(pending.pm && pending.color)) return;

    const top = pile[0];
    const next = pile[1];
    if(!top || !next){
      backToDefaultUI();
      return;
    }

    // on va révéler la prochaine carte
    await advanceOneCard();
    const revealed = pile[0];

    // évaluer
    let okColor = false;
    let okPM = false;

    if(revealed.type === "chiffre"){
      okColor = (revealed.couleur === pending.color);
      if(top.type === "chiffre"){
        if(pending.pm === "plus") okPM = revealed.valeur > top.valeur;
        if(pending.pm === "moins") okPM = revealed.valeur < top.valeur;
      }else{
        okPM = false;
      }
    }

    let win = (okColor || okPM);
    if(mythoActive) win = !win;

    if(win){
      onWin(1);
    }else{
      // si “petite soeur” active, proposer purple de sauvetage
      if(petiteSoeurActive && petiteSoeurActive.forPlayerIndex === joueurIndex){
        await petiteSoeurRescueFlow();
      }else{
        await onLoseFlow({reason:"visiontrouble"});
        endTurnToNextPlayer();
      }
    }

    backToDefaultUI();
  });

  wrap.appendChild(row1);
  wrap.appendChild(row2);
  wrap.appendChild(validate);
  panel.appendChild(wrap);
}

function mkSelectBtn(text, colorKey, onClick, isSelected){
  const b = document.createElement("button");
  b.className = "btn-action";
  b.textContent = text;
  b._color = colorKey;
  b._isSelected = isSelected;
  b.addEventListener("click", onClick);
  if(colorKey === "orange") b.style.color = "var(--orange)";
  if(colorKey === "vert") b.style.color = "var(--vert)";
  return b;
}

/* ---- Copains: choisir joueurs à partager (sans le joueur actuel) ---- */
function startCopainsMode(){
  uiMode = "copains";
  pending = { selected: new Set() };
  switchToPanel();

  const wrap = document.createElement("div");
  wrap.className = "panel-wrap";

  const list = document.createElement("div");
  list.className = "panel-list";

  joueurs.forEach((name, idx)=>{
    if(idx === joueurIndex) return;
    const b = document.createElement("button");
    b.className = "btn-action";
    b.textContent = name;

    b.addEventListener("click", ()=>{
      if(pending.selected.has(idx)){
        pending.selected.delete(idx);
        b.classList.remove("armed");
        b.dataset.color = "";
        b.style.color = "";
      }else{
        pending.selected.add(idx);
        b.classList.add("armed");
        b.dataset.color = "purple";
        b.style.color = "#000";
      }
    });

    list.appendChild(b);
  });

  const validate = document.createElement("button");
  validate.className = "btn-action armed";
  validate.dataset.color = "white";
  validate.textContent = "Valider";
  validate.addEventListener("click", ()=>{
    copainsActive = {
      forPlayerIndex: joueurIndex,
      selectedIndices: [...pending.selected]
    };
    showPopup(`Carte <span class="pink">C’est les copains !</span> : partage défini pour le prochain guess.`);
    backToDefaultUI();
  });

  wrap.appendChild(list);
  wrap.appendChild(validate);
  panel.appendChild(wrap);
}

/* ---- Pilier: choisir 1 joueur ---- */
function startPilierMode(){
  uiMode = "pilier";
  pending = { selected: null };
  switchToPanel();

  const wrap = document.createElement("div");
  wrap.className = "panel-wrap";

  const list = document.createElement("div");
  list.className = "panel-list";

  joueurs.forEach((name, idx)=>{
    if(idx === joueurIndex) return;
    const b = document.createElement("button");
    b.className = "btn-action";
    b.textContent = name;
    b.addEventListener("click", ()=>{
      pending.selected = idx;
      [...list.querySelectorAll("button")].forEach(x=>{
        x.classList.remove("armed");
        x.dataset.color = "";
        x.style.color = "";
      });
      b.classList.add("armed");
      b.dataset.color = "purple";
      b.style.color = "#000";
    });
    list.appendChild(b);
  });

  const validate = document.createElement("button");
  validate.className = "btn-action disabled";
  validate.textContent = "Valider";
  validate.disabled = true;

  list.addEventListener("click", ()=>{
    validate.disabled = (pending.selected === null);
    validate.classList.toggle("disabled", validate.disabled);
    if(!validate.disabled){
      validate.classList.add("armed");
      validate.dataset.color = "white";
    }
  });

  validate.addEventListener("click", ()=>{
    if(pending.selected === null) return;
    pilierActive = { forPlayerIndex: joueurIndex, otherIndex: pending.selected };
    showPopup(`Carte <span class="pink">Pilier de comptoir</span> : si tu perds au prochain guess, <span class="pink">${escapeHtml(joueurs[pending.selected])}</span> boit avec toi.`);
    backToDefaultUI();
  });

  wrap.appendChild(list);
  wrap.appendChild(validate);
  panel.appendChild(wrap);
}

/* ---- Analyse: choisir plus/moins sur SOMME des 2 prochaines cartes vs carte actuelle ---- */
function startAnalyseMode(){
  uiMode = "analyse";
  pending = { pm: "plus" };
  switchToPanel();

  const wrap = document.createElement("div");
  wrap.className = "panel-wrap";

  const row = document.createElement("div");
  row.className = "panel-row";

  const bPlus = document.createElement("button");
  bPlus.className = "btn-action armed";
  bPlus.dataset.color = "white";
  bPlus.textContent = "Plus";

  const bMoins = document.createElement("button");
  bMoins.className = "btn-action";
  bMoins.textContent = "Moins";

  function refresh(){
    if(pending.pm === "plus"){
      bPlus.classList.add("armed"); bPlus.dataset.color="white";
      bMoins.classList.remove("armed"); bMoins.dataset.color="";
    }else{
      bMoins.classList.add("armed"); bMoins.dataset.color="white";
      bPlus.classList.remove("armed"); bPlus.dataset.color="";
    }
  }
  bPlus.addEventListener("click", ()=>{ pending.pm = "plus"; refresh(); });
  bMoins.addEventListener("click", ()=>{ pending.pm = "moins"; refresh(); });

  row.appendChild(bPlus);
  row.appendChild(bMoins);

  const validate = document.createElement("button");
  validate.className = "btn-action armed";
  validate.dataset.color = "white";
  validate.textContent = "Valider";

  validate.addEventListener("click", async ()=>{
    const top = pile[0];
    const c1 = pile[1];
    const c2 = pile[2];

    // besoin de 2 chiffres après
    if(!top || top.type !== "chiffre" || !c1 || !c2 || c1.type !== "chiffre" || c2.type !== "chiffre"){
      showPopup(`Analyse impossible : il faut que les <span class="pink">2 prochaines</span> soient des cartes chiffres.`);
      backToDefaultUI();
      return;
    }

    const sum = c1.valeur + c2.valeur;
    let win = false;
    if(pending.pm === "plus") win = sum > top.valeur;
    if(pending.pm === "moins") win = sum < top.valeur;

    if(mythoActive) win = !win;

    // on montre 2 cartes comme purple: c1 visible 3s puis c2 reste
    if(win){
      onWin(2);
      await advanceOneCard();   // révèle c1
      await sleep(3000);
      await advanceOneCard();   // révèle c2
    }else{
      // perte
      await onLoseFlow({reason:"analyse"});
      await advanceOneCard();   // révèle c1
      await sleep(3000);
      await advanceOneCard();   // révèle c2
      endTurnToNextPlayer();
    }

    backToDefaultUI();
  });

  wrap.appendChild(row);
  wrap.appendChild(validate);
  panel.appendChild(wrap);
}

/* =========================
   “C’EST CADEAU” : prochain joueur choisit ton guess
========================= */
async function startCadeauChooser(){
  if(!cadeauActive) return;

  uiMode = "cadeau_choose";
  pending = { chosen: null };
  switchToPanel();

  const chooser = joueurs[cadeauActive.chooserPlayerIndex];
  showPopup(`<span class="pink">${escapeHtml(chooser)}</span> choisit le prochain guess pour <span class="pink">${escapeHtml(currentPlayerName())}</span>.`);

  const wrap = document.createElement("div");
  wrap.className = "panel-wrap";

  // mêmes actions que default, mais sous contrôle du chooser
  const grid = document.createElement("div");
  grid.className = "grid-3x2";
  grid.style.padding = "0";

  const actions = [
    ["Plus","plus"],
    ["Moins","moins"],
    ["Orange","orange"],
    ["Vert","vert"],
    ["Purple","purple"],
    ["Valider","valider"]
  ];

  const btnMap = new Map();

  actions.forEach(([label, act])=>{
    const b = document.createElement("button");
    b.className = "btn-action";
    b.textContent = label;

    if(act === "orange") b.style.color = "var(--orange)";
    if(act === "vert") b.style.color = "var(--vert)";
    if(act === "purple") b.style.color = "var(--rose)";
    if(act === "valider"){
      b.classList.add("disabled");
      b.disabled = true;
      b.textContent = "Valider";
    }

    b.addEventListener("click", ()=>{
      if(act === "valider") return;
      pending.chosen = act;

      // highlight
      [...grid.querySelectorAll("button")].forEach(x=>{
        if(x === b) return;
        if(x.textContent === "Valider") return;
        x.classList.remove("armed");
        x.dataset.color = "";
        x.style.color = (x.textContent==="Orange") ? "var(--orange)" :
                        (x.textContent==="Vert") ? "var(--vert)" :
                        (x.textContent==="Purple") ? "var(--rose)" : "";
      });

      b.classList.add("armed");
      b.dataset.color = (act==="orange")?"orange":(act==="vert")?"vert":(act==="purple")?"purple":"white";
      b.style.color = "#000";

      const v = btnMap.get("valider");
      v.disabled = false;
      v.classList.remove("disabled");
      v.classList.add("armed");
      v.dataset.color = "white";
    });

    btnMap.set(act, b);
    grid.appendChild(b);
  });

  btnMap.get("valider").addEventListener("click", async ()=>{
    const chosen = pending.chosen;
    if(!chosen) return;

    // Résoudre comme un guess normal, MAIS si perdu => c’est le joueur courant qui boit (pas le chooser)
    // Pour simplifier: on force une résolution directe via fonctions, mais en cas de perte on attribue au joueur courant (déjà le cas).
    // Ensuite on désactive le cadeau.
    cadeauActive = null;
    backToDefaultUI();

    // On lance le guess choisi
    if(chosen === "purple") await resolvePurple();
    else if(chosen === "orange" || chosen === "vert") await resolveColorGuess(chosen);
    else if(chosen === "plus" || chosen === "moins") await resolvePlusMoins(chosen);
  });

  wrap.appendChild(grid);
  panel.appendChild(wrap);
}

/* =========================
   PETITE SOEUR: rescue purple si perte
   - si réussite : +2 et on continue
   - si échec : boit double (compteur *2, puis reset)
========================= */
async function petiteSoeurRescueFlow(){
  // proposer un purple, si impossible => perte normale
  const c1 = pile[1];
  const c2 = pile[2];
  const purpleOK = c1 && c2 && c1.type === "chiffre" && c2.type === "chiffre";

  if(!purpleOK){
    await onLoseFlow({reason:"petitesoeur"});
    endTurnToNextPlayer();
    return;
  }

  // choix: tenter purple
  showPopup(`Sauvetage <span class="pink">Petite soeur</span> : tente un <span class="pink">Purple</span> pour t’en sortir.`);

  // tenter purple
  const diff = (c1.couleur !== c2.couleur);
  let win = diff;
  if(mythoActive) win = !win;

  if(win){
    onWin(2);
    await advanceOneCard();
    await sleep(3000);
    await advanceOneCard();
  }else{
    // boit double
    const amountBase = compteur;
    const amount = (doubleDoseActive ? amountBase*2 : amountBase) * 2;

    const name = currentPlayerName();
    showPopup(`<span class="pink">${escapeHtml(name)}</span> boit <span class="pink">${amount}</span> gorgées (double). Plastiquement vôtre !`);

    compteur = 0;
    mythoActive = false;
    doubleDoseActive = false;
    hasWonThisTurn = false;

    await advanceOneCard();
    await sleep(3000);
    await advanceOneCard();

    endTurnToNextPlayer();
  }

  petiteSoeurActive = null;
}

/* =========================
   CLICK SUR LA CARTE
   - Si la carte du dessus est spéciale ou règle, on autorise “continuer” en cliquant
   - Sinon: on ne fait rien (le joueur doit utiliser les boutons)
========================= */
pileEl.addEventListener("click", async ()=>{
  if(animating) return;
  const top = pile[0];
  if(!top) return;

  if(uiMode !== "default") return;

   if(top.type === "speciale" || top.type === "regle"){
   // Le joueur clique pour "continuer" : on passe à la carte suivante
   await advanceOneCard();

   // Si la carte spéciale impose une fin de tour (ex: tournée générale / balle neuve),
   // onCardRevealed() s’en charge déjà.
   return;
 }

  // si carte chiffre: pas d’action au clic (le joueur doit guess via boutons)
});

/* =========================
   BOOT
========================= */
// écran setup visible au chargement
setupScreen.classList.add("active");
playScreen.classList.remove("active");
hidePopup();
