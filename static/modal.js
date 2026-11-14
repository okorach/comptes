/* Modal windows: confirmation (with, if wanted, a text to type) and error messages.
   Promise based: `await confirmDialog({...})` gives true or false, `await errorDialog(message)` returns when the window is closed.
   Escape, a click outside the window and « Annuler » answer false. */
const MODAL_ICONS = {
  danger: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
};
let MODAL = null;  // window being shown: {resolve, require}

function modalButton(b){
  const click = b.submit ? '' : ' onclick="modalDone(' + b.value + ')"';
  return '<button type="' + (b.submit ? 'submit' : 'button') + '" class="' + (b.cls || '') + '" id="' + b.id + '"' + (b.disabled ? ' disabled' : '') + click + '>' + esc(b.label) + '</button>';
}

function modalMarkup(o){
  const icon = '<div class="modal-icon ' + o.tone + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + MODAL_ICONS[o.tone] + '</svg></div>';
  const strong = o.strong ? '<div class="modal-name d">' + esc(o.strong) + '</div>' : '';
  const input = o.require === null ? '' : '<input id="m_input" autocomplete="off" spellcheck="false" aria-label="' + esc(o.inputLabel) + '" oninput="modalCheck()">';
  return '<div class="modal-back" onclick="if (event.target === this) modalDone(false)">'
    + '<form class="modal" role="alertdialog" aria-modal="true" aria-labelledby="m_title" aria-describedby="m_msg" onsubmit="modalDone(true); return false">'
    + '<div class="modal-head">' + icon + '<div class="modal-text"><h2 id="m_title">' + esc(o.title) + '</h2><p id="m_msg">' + esc(o.message) + '</p>' + strong + input + '</div></div>'
    + '<div class="modal-actions">' + o.buttons.map(modalButton).join('') + '</div></form></div>';
}

function openModal(o){
  if (MODAL) modalDone(false);
  return new Promise(resolve => {
    MODAL = {resolve, require: o.require};
    $('#guard').innerHTML = modalMarkup(o);
    ($('#m_input') ?? $('#m_cancel') ?? $('#m_ok'))?.focus?.();  // the safe choice (or the text to type) has the focus
  });
}

/* Closes the window with the answer. A window asking for a text only answers true when it is typed exactly. */
function modalDone(value){
  const m = MODAL;
  if (!m) return;
  if (value && m.require !== null && $('#m_input').value !== m.require) return;
  MODAL = null;
  $('#guard').innerHTML = '';
  m.resolve(value);
}
const modalCheck = () => { $('#m_ok').disabled = $('#m_input').value !== MODAL.require; };
window.addEventListener('keydown', e => { if (e.key === 'Escape' && MODAL) modalDone(false); });

/* {title, message, strong?: a name shown in bold, require?: text to type to confirm, inputLabel?, confirmLabel?} */
function confirmDialog({title, message, strong = '', require = null, inputLabel = '', confirmLabel = 'Confirmer'}){
  return openModal({
    tone: 'danger', title, message, strong, require, inputLabel,
    buttons: [{label: 'Annuler', value: false, id: 'm_cancel'}, {label: confirmLabel, submit: true, id: 'm_ok', cls: 'danger', disabled: require !== null}],
  });
}

function errorDialog(message, title = 'Erreur'){
  return openModal({tone: 'error', title, message, strong: '', require: null, buttons: [{label: 'Fermer', value: true, id: 'm_ok', cls: 'primary'}]});
}
