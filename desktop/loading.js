document.getElementById('minimize').onclick = () => window.yusuiDesktop.window('minimize');
document.getElementById('close').onclick = () => window.yusuiDesktop.window('close');
window.yusuiDesktop.onLoading(({ message, error }) => {
  document.getElementById('status').textContent = message;
  document.body.classList.toggle('error', error);
});
