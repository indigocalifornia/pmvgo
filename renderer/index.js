'use strict';

const { ipcRenderer } = require('electron');
const { dialog } = require('electron').remote;
const uuid = require('uuid');

document.getElementById('source-dir-button').addEventListener('click', () => {
  const sourceDir = dialog.showOpenDialog({properties:["openDirectory"]})[0];
  document.getElementById('sourceDir').value = sourceDir;
});

document.getElementById('temp-dir-button').addEventListener('click', () => {
  const tempDir = dialog.showOpenDialog({properties:["openDirectory"]})[0];
  document.getElementById('tempDir').value = tempDir;
});

document.getElementById('audio-button').addEventListener('click', () => {
  const audio = dialog.showOpenDialog();
  if (audio) {
    document.getElementById('audio').value = audio;
  }
});

document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();

  const params = {
    sourceDir: e.target.sourceDir.value,
    tempDir: e.target.tempDir.value,
    audio: e.target.audio.value,
    bpm: e.target.bpm.value,
    duration: e.target.duration.value,
    offset: e.target.offset.value
  };

  if (Object.values(params).some(i => !i || '')) {
    document.getElementById('primaryStatus').innerHTML = `
      <span class="text-error">
      Source directory and temp directory must be valid paths to a folder,
      audio must be valid path to an audio file,
      bpm and duration must be integers and offset must be a float.
      </span>
    `;
    return;
  }

  document.getElementById('cancel').style.display = 'inline-block';
  document.getElementById('openSave').style.display = 'none';

  ipcRenderer.send('process', params);
});

document.getElementById('cancel').addEventListener('click', () => {
  ipcRenderer.send('cancel');
});

document.getElementById('open').addEventListener('click', () => {
  ipcRenderer.send('open');
});

document.getElementById('save').addEventListener('click', () => {
  // todo: dont regenerate uuid
  const name = uuid.v1().slice(0, 6) + '.mp4';
  const savePath = dialog.showSaveDialog({
    defaultPath: name
  });

  if (savePath) {
    ipcRenderer.send('save', savePath);
  }
});

document.getElementById('delete').addEventListener('click', () => {
  document.getElementById('openSave').style.display = 'none';
  ipcRenderer.send('delete');
});

ipcRenderer.on('settings', (_, settings) => {
  document.getElementById('sourceDir').value = settings.sourceDir || "";
  document.getElementById('tempDir').value = settings.tempDir || "";
  document.getElementById('audio').value = settings.audio || "";
  document.getElementById('bpm').value = settings.bpm || "";
  document.getElementById('duration').value = settings.duration || "";
  document.getElementById('offset').value = settings.offset || "";
});

ipcRenderer.on('primaryStatus', (_, text) => {
  document.getElementById('primaryStatus').innerHTML = text;
});

ipcRenderer.on('secondaryStatus', (_, text) => {
  document.getElementById('secondaryStatus').innerHTML = text;
});

ipcRenderer.on('done', () => {
  document.getElementById('cancel').style.display = 'none';
  document.getElementById('openSave').style.display = 'block';
});
