const game = document.getElementById("game");
const body = document.body;

/* =========================
   DOS
========================= */

const DOS = {
  chiffre: "assets/cartes/dos/dos-noir.png",
  speciale: "assets/cartes/dos/dos-rose.png",
  regle: "assets/cartes/dos/dos-regle.png"
};

/* =========================
   ROTATION CONTRÔLÉE
========================= */

function randomRotation() {
  const sign = Math.random() < 0.5 ? -1 : 1;
  const value = Math.random() * 5 + 3; // 3 → 8
  return +(sign * value).toFixed(2);
}

function creerCarte(data) {
  return { ...data, rotation: randomRotation() };
}

/* =========================
   CARTES
========================= */

const chiffres = [];
const couleurs = ["vert", "orange"];

for (let couleur of couleurs) {
  for (let i = 0; i <= 9; i++) {
    for (let k = 0; k < 4; k++) {
      chiffres.push(creerCarte({
        type: "chiffre",
        image: `assets/cartes/chiffres/chiffre-${i}-${couleur}.png`,
        dos: DOS.chiffre
      }));
    }
  }
}

const cartesSpeciales = [
  "mytho",
  "doubledose",
  "unpetitdernier?",
  "tourneegenerale",
  "pl(s)",
  "visiontrouble",
  "cestlescopains!",
  "analyse",
  "pilierdecomptoir",
  "pressionsociale",
  "cestcadeau",
  "lapetitesoeur",
  "balleneuve"
].map(nom =>
  creerCarte({
    type: "speciale",
    nom,
    image: `assets/cartes/speciales/speciale-${nom}.png`,
    dos: DOS.speciale
  })
);

const cartesRegles = ["1", "2", "3", "4"].map(id => ({
  type: "regle",
  image: `assets/cartes/regles/regle-${id}.png`,
  dos: DOS.regle,
  rotation: 0
}));

/* =========================
   PIOCHES
========================= */

let piocheInitiale = [...cartesRegles];
const piochePrincipale = [...chiffres, ...cartesSpeciales];

function tirerCarte() {
  if (piocheInitiale.length > 0) return piocheInitiale.shift();
  return piochePrincipale[Math.floor(Math.random() * piochePrincipale.length)];
}

/* =========================
   PILE
========================= */

const NB_CARTES_VISIBLES = 5;
let pile = [];
let animating = false;

/* =========================
   INITIALISATION (INTRO)
========================= */

function initPile() {
  pile = [];
  game.innerHTML = "";
  body.classList.remove("special-bg", "reset-bg");

  // 4 règles
  for (let i = 0; i < 4; i++) {
    pile.push(tirerCarte());
  }

  // 5e carte = chiffre
  pile.push(chiffres[Math.floor(Math.random() * chiffres.length)]);

  renderPile(true);
}

/* =========================
   RENDU
========================= */

function renderPile(isIntro = false) {
  game.innerHTML = "";

  pile.forEach((carte, index) => {
    const card = document.createElement("div");
    card.classList.add("card");

    if (isIntro) card.classList.add("intro");

    if (index === 0) {
      card.classList.add("active");
    } else {
      card.classList.add(`stack-${index}`);
      card.style.transform =
        `translate(-50%, -50%) rotate(${carte.rotation}deg) translateY(${index * 14}px)`;
    }

    const back = document.createElement("div");
    back.classList.add("card-face", "card-back");
    back.style.backgroundImage = `url("${carte.dos}")`;

    const front = document.createElement("div");
    front.classList.add("card-face", "card-front");
    front.style.backgroundImage = `url("${carte.image}")`;

    card.appendChild(back);
    card.appendChild(front);
    game.appendChild(card);

    // intro : cartes distribuées une à une
    if (isIntro) {
      setTimeout(() => {
        card.classList.remove("intro");
      }, 150 + index * 150);
    }

    // flip + fond rose
    if (index === 0) {
      setTimeout(() => {
        card.classList.add("flipped");

        if (
          carte.type === "speciale" &&
          carte.nom !== "balleneuve"
        ) {
          body.classList.add("special-bg");
        }
      }, isIntro ? 900 : 60);
    }
  });
}

/* =========================
   INTERACTION
========================= */

function tirerEtAnimer() {
  if (animating) return;
  animating = true;

  // retour fond gris
  if (body.classList.contains("special-bg")) {
    body.classList.remove("special-bg");
    body.classList.add("reset-bg");

    setTimeout(() => body.classList.remove("reset-bg"), 450);
  }

  const carteActive = document.querySelector(".card.active");
  if (!carteActive) return;

  carteActive.classList.add("tap");
  setTimeout(() => carteActive.classList.remove("tap"), 120);

  carteActive.classList.add("exit");

  setTimeout(() => {
    pile.shift();
    pile.push(tirerCarte());
    renderPile();
    animating = false;
  }, 450);

}

game.addEventListener("click", tirerEtAnimer);

/* =========================
   LANCEMENT
========================= */

initPile();
