'use strict';

const path = require('path');
const { app, ipcMain, shell, BrowserWindow } = require('electron');
const Store = require('electron-store');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-downloader').path;
const ffmpeg = require('fluent-ffmpeg');
const uuid = require('uuid');
const rimraf = require('rimraf');

// require('electron-reload')(__dirname, {
//   electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
// });

ffmpeg.setFfmpegPath(ffmpegPath);

const defaultProps = {
  width: 1200,
  height: 800,
  show: false,
  webPreferences: {
    nodeIntegration: true
  }
};

class Window extends BrowserWindow {
  constructor({ file, ...windowSettings }) {
    super({ ...defaultProps, ...windowSettings });

    this.loadFile(file);
    // this.webContents.openDevTools();
    this.once('ready-to-show', () => {
      this.show();
    });
  }
}

const store = new Store();
let mainWindow, command;

function main() {
  mainWindow = new Window({
    file: path.join('renderer', 'index.html')
  });

  mainWindow.once('show', () => {
    const settings = store.get('settings');
    console.log('Loading settings', settings);

    mainWindow.webContents.send('settings', settings || {});
  });

  ipcMain.on('process', (_, params) => {
    const settings = Object.assign({}, );

    const paramsToSettings = Object.keys(params).reduce(function(obj, k) {
      if (params[k]) {
        obj[k] = params[k];
      }
      return obj;
    }, {});

    console.log('Updating settings', paramsToSettings);

    store.set('settings', Object.assign(settings, paramsToSettings));

    start();
  });

  ipcMain.on('cancel', () => {
    if (command) {
      mainWindow.webContents.send('primaryStatus', 'Canceled');
      mainWindow.webContents.send('secondaryStatus', '<br>');
      command.kill();
    }
  });

  ipcMain.on('open', () => {
    const finalFile = store.get('finalFile');
    shell.openItem(finalFile);
  });

  ipcMain.on('save', (_, savePath) => {
    const finalFile = store.get('finalFile');
    fs.copyFileSync(finalFile, savePath);
  });

  ipcMain.on('delete', (_, savePath) => {
    for (var dirName of ['segmentsDir', 'workDir', 'randomDir']) {
      const dir = store.get(dirName);
      rimraf.sync(dir);
    }
    mainWindow.webContents.send('primaryStatus', 'All files deleted');
  });
}

app.on('ready', main);

app.on('will-quit', function () {
  if (command) {
    command.kill();
  }
});

app.on('window-all-closed', function () {
  if (command) {
    command.kill();
  }
  app.quit();
});

function start() {
  preProcess();
  runAudio();
}

function preProcess() {
  mainWindow.webContents.send('primaryStatus', 'Preparing work environment');

  const settings = store.get('settings');
  const sourceDir = settings.sourceDir;
  const tempDir = settings.tempDir;

  const sourceFiles = fs.readdirSync(sourceDir)
    .filter(item => !(/(^|\/)\.[^\/\.]/g).test(item)) // exclude hidden files
    .map(item => path.join(sourceDir, item));
  store.set('sourceFiles', sourceFiles);

  for (var dirName of ['segmentsDir', 'workDir', 'randomDir']) {
    const dir = path.join(tempDir, 'pmv_' + dirName);
    store.set(dirName, dir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    var files = fs.readdirSync(dir);
    for (const file of files) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

function runAudio() {
  mainWindow.webContents.send('primaryStatus', 'Processing audio');

  const audio = store.get('settings').audio;

  ffmpeg.ffprobe(audio, function (err, metadata) {
    if (err) {
      mainWindow.webContents.send('primaryStatus', err);
      return;
    }

    const audioDuration = metadata.format.duration;
    store.set('audioDuration', audioDuration);
    copyAudio();
  });
}

function copyAudio() {
  const audio = store.get('settings').audio;
  const workDir = store.get('workDir');

  const ext = path.extname(audio);
  const name = path.basename(audio, ext);
  const saveFile = path.join(workDir, name + '.m4a');

  command = ffmpeg(audio)
    .inputOptions('-y')
    .audioCodec('aac')
    .noVideo()
    .on('error', (err) => {
      console.log(`An error occurred: ${err.message}`);
      mainWindow.webContents.send(
        'primaryStatus', `An error occurred: ${err.message}`
      );
    })
    .on('progress', (progress) => {
      console.log(`Processing: ${progress.percent}% done`);
      mainWindow.webContents.send(
        'secondaryStatus',
        `Progress: ${progress.percent ? progress.percent.toFixed(3) : null}%`
      );
    })
    .on('end', () => {
      store.set('audio', saveFile);
      processAudio();
    })
    .save(saveFile);
}

function processAudio() {
  const settings = store.get('settings');
  const audioDuration = store.get('audioDuration');

  const bpm = parseInt(settings.bpm);
  const duration = parseInt(settings.duration);

  var diff = 60. / bpm;
  diff = diff * duration;

  var beats = [];
  for (var i = 0; i <= audioDuration + diff; i = i + diff) {
    beats.push(i);
  }
  store.set('beats', beats);

  makeRandom();
}

function makeRandom() {
  randomForFile(0, 0);
}

function randomForFile(position, totalDuration) {
  const randomDir = store.get('randomDir');
  const segments = store.get('segments');
  const beats = store.get('beats');

  const sourceFiles = store.get('sourceFiles');

  if (position >= beats.length - 1) {
    console.log('FINISHED RANDOMS');
    makeJoinFile();
    joinVideo();
    return;
  }

  mainWindow.webContents.send(
    'primaryStatus',
    `Generating compilation ${position + 1}/${beats.length - 1}`
  );

  const file = sourceFiles[Math.floor(Math.random() * sourceFiles.length)];

  const diff = beats[position + 1] - totalDuration;

  if (diff <= 0) {
    randomForFile(position + 1, totalDuration);
    return;
  }

  var name = modifyFilename(file);
  name = position + '_' + name;

  const saveFile = path.join(randomDir, name);

  ffmpeg.ffprobe(file, function(err, metadata) {
      const duration = metadata.format.duration;
      const start = randomBetween(0, duration);

      console.log('start', start);

      command = ffmpeg(file)
        .noAudio()
        .seekInput(start)
        .duration(diff)
        .videoBitrate(5000000)
        .outputOptions(
          [
            '-mbd', 'rd', '-trellis', '2', '-cmp', '2', '-subcmp', '2',
            '-g', '100', '-f', 'mpeg'
          ]
        )
        .on('error', (err) => {
          console.log(`An error occurred: ${err}`);
          if (err.message == 'ffmpeg was killed with signal SIGKILL') {
            return;
          }
          randomForFile(position + 1, totalDuration);
        })
        .on('progress', (progress) => {
          console.log(`Processing: ${progress.percent}% done`);
          mainWindow.webContents.send('secondaryStatus', '<br>');
        })
        .on('end', () => {
          ffmpeg.ffprobe(saveFile, function (err, metadata) {
            let newDuration = 0;

            if (err) {
              console.log(err);
              return;
            }
            else if (metadata.format.duration <= 0) {
              fs.unlinkSync(saveFile);
            } else {
              newDuration = metadata.format.duration;
            }

            // todo: dont increase diff if output is bad
            randomForFile(position + 1, totalDuration + newDuration);
          });
        })
        .save(saveFile);
  });
}

function makeJoinFile() {
  console.log('MAKING JOIN FILE');

  mainWindow.webContents.send('primaryStatus', `Merging compilation`);

  const randomDir = store.get('randomDir');
  const workDir = store.get('workDir');

  const files = fs.readdirSync(randomDir)
    .map(item => path.join(randomDir, item))
    .sort(
      (a, b) => a.localeCompare(
        b, undefined, { numeric: true, sensitivity: 'base' }
      )
    );

  const joinFile = path.join(workDir, 'join.txt');
  store.set('joinFile', joinFile);

  fs.writeFileSync(joinFile, files.map(i => `file '${i}'`).join('\n'));
}

function joinVideo() {
  const workDir = store.get('workDir');
  const joinFile = store.get('joinFile');

  const video = path.join(workDir, 'all.mp4');
  store.set('video', video);

  ffmpeg()
    .input(joinFile)
    .inputFormat('concat')
    .inputOptions(['-auto_convert', '1', '-safe', '0'])
    .outputOptions('-y')
    .videoCodec('copy')
    .noAudio()
    .on('progress', progress => {
      mainWindow.webContents.send(
        'secondaryStatus', `<br>` // progress.percent is very large
      );
    })
    .on('error', err => {
      console.log(err.message);
      mainWindow.webContents.send(
        'primaryStatus', `An error occurred: ${err.message}`
      );
    })
    .on('end', () => {
      console.log('FINISHED JOIN');
      joinVideoAudio();
    })
    .save(video);
}

function joinVideoAudio() {
  mainWindow.webContents.send(
    'primaryStatus',
    'Putting video and audio together'
  );

  const workDir = store.get('workDir');
  const video = store.get('video');
  const audio = store.get('audio');
  const offset = -parseFloat(store.get('settings').offset);

  const saveFile = path.join(workDir, 'all_final.mp4');
  store.set('finalFile', saveFile);

  command = ffmpeg(video)
    .addInput(audio)
    .inputOptions(['-itsoffset', offset])
    .audioCodec('copy')
    .videoCodec('copy')
    .outputOption('-shortest')
    .on('error', (err) => {
      console.log(`An error occurred: ${err.message}`);
      mainWindow.webContents.send(
        'primaryStatus', `An error occurred: ${err.message}`
      );
    })
    .on('progress', (progress) => {
      console.log(`Processing: ${progress.percent}% done`);
      mainWindow.webContents.send(
        'secondaryStatus',
        `Progress: ${progress.percent ? progress.percent.toFixed(3) : null}%`
      );
    })
    .on('end', () => {
      console.log('FINISHED MERGING VIDEO AND AUDIO');
      encode();
    })
    .save(saveFile);
}

function encode() {
  mainWindow.webContents.send('primaryStatus', `Encoding final file`);

  const finalFile = store.get('finalFile');
  const workDir = store.get('workDir');

  const name = uuid.v1().slice(0, 6) + '.mp4';
  const saveFile = path.join(workDir, name);

  command = ffmpeg(finalFile)
    .audioCodec('copy')
    .videoCodec('libx264')
    .outputOptions(['-preset', 'ultrafast'])
    // todo variable final dimensions
    .videoFilters('scale=w=1280:h=720:force_original_aspect_ratio=decrease')
    .audioCodec('copy')
    .on('error', (err) => {
      console.log(`An error occurred: ${err.message}`);
      mainWindow.webContents.send(
        'primaryStatus', `An error occurred: ${err.message}`
      );
    })
    .on('progress', (progress) => {
      console.log(`Processing: ${progress.percent}% done`);
      mainWindow.webContents.send(
        'secondaryStatus',
        `Progress: ${progress.percent ? progress.percent.toFixed(3) : null}%`
      );
    })
    .on('end', () => {
      console.log('FINISHED ENCODING');
      store.set('finalFile', saveFile);
      end();
    })
    .save(saveFile);
}

function end() {
  console.log('DONE');

  const finalFile = store.get('finalFile');

  mainWindow.webContents.send('primaryStatus', 'Complete!');
  mainWindow.webContents.send('secondaryStatus', '<br>');
  mainWindow.webContents.send('done', finalFile);
}

function modifyFilename(file) {
  const ext = path.extname(file);
  // remove bad characters from file name
  const name = path.basename(file, ext).replace(/[/\\?%*:|"<>'"]/g, '-');

  return `${name}${ext}`;
}

function randomBetween(min, max) {
  return Math.random() * (+max - +min) + +min;
}