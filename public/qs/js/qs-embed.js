// =====================================================================
//  Integration dans AapWire : hauteur et signal de disponibilite
// =====================================================================

const params = new URLSearchParams(window.location.search);
const embedded = params.get("embedded") === "1";
if (embedded) document.documentElement.classList.add("embedded");



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
