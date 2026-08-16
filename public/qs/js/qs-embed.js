// =====================================================================
//  Integration dans FinScope : theme, hauteur et signal de disponibilite
// =====================================================================

const params = new URLSearchParams(window.location.search);
const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
};

const embedded = params.get("embedded") === "1";
if (embedded) document.documentElement.classList.add("embedded");
applyTheme(params.get("theme"));

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === "finscope-theme") { applyTheme(event.data.theme); return; }

  //  Une table envoyee par la page hote entre exactement par ou entre un
  //  copier-coller : on remplit la zone de saisie, on annonce la saisie pour
  //  que l'application mette son etat a jour, puis on appuie sur le bouton.
  //  Le moteur ne sait pas d'ou vient sa table et n'a pas a le savoir.
  if (event.data?.type === "finscope-table" && typeof event.data.table === "string") {
    const zone = document.getElementById("saisie");
    const bouton = document.getElementById("btn-generer");
    if (!zone || !bouton) return;
    zone.value = event.data.table;
    zone.dispatchEvent(new Event("input", { bubbles: true }));
    bouton.click();
    window.parent?.postMessage({ type: "qs-table-loaded" }, window.location.origin);
  }
});

//  La page hote ne peut pas mesurer le contenu d'un cadre : c'est donc a
//  nous d'annoncer notre hauteur. Sans cela le cadre garde une taille fixe
//  et le tableau genere se retrouve dans un second ascenseur.
//
//  Trois declencheurs plutot qu'un : l'observateur de taille couvre le cas
//  courant, mais il reste muet quand un canvas grandit sans que la boite du
//  corps ne soit re-mesuree, et il est mis en veille par certains
//  navigateurs dans un cadre hors ecran. La relecture periodique ne coute
//  rien -- une lecture de hauteur, et un message seulement quand elle change
//  reellement -- et garantit que la page hote finit toujours par apprendre
//  la bonne hauteur.
if (embedded) {
  let derniere = 0;
  const annoncer = () => {
    const h = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(h - derniere) < 8) return;
    derniere = h;
    window.parent?.postMessage({ type: "qs-height", height: h }, window.location.origin);
  };
  if (window.ResizeObserver) new ResizeObserver(annoncer).observe(document.body);
  new MutationObserver(annoncer).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("load", annoncer);
  setInterval(annoncer, 400);
  annoncer();
}

window.parent?.postMessage({ type: "qs-ready" }, window.location.origin);
