'use strict';

const path = require('path');
const { app, ipcMain, shell, BrowserWindow } = require('electron');
const Store = require('electron-store');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-downloader').path;
const ffmpeg = require('fluent-ffmpeg');
const uuid = require('uuid');
const rimraf = require('rimraf');
const { mainReloader, rendererReloader } = require('electron-hot-reload');

// const { preProcess } = require('./process/preprocess');

// let ffmpegPath;
// if (process.env.NODE_ENV === 'development') {
//   ffmpegPath = path.join(
//     path.join(__dirname, 'ffmpeg-binaries', 'win32', 'x64'),
//     'ffmpeg'
//   );
// } else {
//   ffmpegPath = path.join(process.resourcesPath, 'bin', 'ffmpeg');
// }

// console.log(ffmpegPath);

ffmpeg.setFfmpegPath(ffmpegPath);
const defaultProps = {
  width: 1300,
  height: 900,
  show: false,
  webPreferences: {
    nodeIntegration: true,
  }
};

// const mainFile = path.join(app.getAppPath(), 'main.js');
// const rendererFile = path.join(app.getAppPath(), 'renderer', 'index.js');

// mainReloader([mainFile], undefined, (error, path) => {
//   console.log("It is a main's process hook!");
// });

// rendererReloader([rendererFile], undefined, (error, path) => {
//   console.log("It is a renderer's process hook!");
// });

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
let mainWindow, command, timestamp, retryFunction, eta;

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
    const settings = Object.assign({},);

    const paramsToSettings = Object.keys(params).reduce(function (obj, k) {
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

  ipcMain.on('retry', () => {
    if (retryFunction) {
      retryFunction();
    }
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

function retry(retryFn) {
  mainWindow.webContents.send('showRetry');
  retryFunction = retryFn;
}

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
      retry(runAudio);
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

  console.log(
    'beats',
    beats.slice(0, 10),
    beats.slice(beats.length - 10, beats.length - 1),
    beats.length
  );

  timestamp = Date.now();
  makeRandom();
}

function makeRandom() {
  eta = new ETA();

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

  const elapsed = Math.round((Date.now() - timestamp) / 1000);
  const left = Math.round(eta.eta(position + 1, beats.length - 1) / 1000);

  mainWindow.webContents.send(
    'primaryStatus',
    `Generating compilation ${position + 1}/${beats.length - 1}`
  );

  mainWindow.webContents.send(
    'secondaryStatus',
    `Time left ${left}s`
  );

  const file = sourceFiles[Math.floor(Math.random() * sourceFiles.length)];

  const diff = beats[position + 1] - totalDuration;

  console.log('beats next position', beats[position + 1], 'total duration', totalDuration, 'diff', diff);

  if (diff <= 0) {
    randomForFile(position + 1, totalDuration);
    return;
  }

  var name = modifyFilename(file);
  name = position + '_' + name;

  const saveFile = path.join(randomDir, name);

  ffmpeg.ffprobe(file, function (err, metadata) {
    const duration = metadata.format.duration;
    const start = randomBetween(0, duration);

    command = ffmpeg(file)
      .noAudio()
      .seekInput(start)
      .duration(diff)
      .videoBitrate(5000000)
      // .inputOptions([
      //   '-hwaccel', 'cuvid', '-vsync', '0', '-c:v', 'h264_cuvid'
      // ])
      .outputOptions(
        [
          '-mbd', 'rd', '-trellis', '2', '-cmp', '2', '-subcmp', '2',
          '-g', '100',
          // '-c:v', 'h264_nvenc',
          '-f', 'mpeg'
        ]
      )
      .on('error', (err) => {
        console.log(`An error occurred: ${err}`);
        if (err.message == 'ffmpeg was killed with signal SIGKILL') {
          return;
        }
        fs.unlinkSync(saveFile);
        randomForFile(position + 1, totalDuration);
      })
      .on('progress', (progress) => {
        console.log(`Processing: ${progress.percent}% done`);
        // mainWindow.webContents.send('secondaryStatus', '<br>');
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

          console.log('new duration', newDuration, 'next total duration', totalDuration + newDuration);

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

  const saveFile = path.join(workDir, 'all_final.mp4');
  store.set('finalFile', saveFile);

  command = ffmpeg(video)
    .addInput(audio)
    .audioCodec('copy')
    .videoCodec('copy')
    .outputOption('-shortest')
    .on('error', (err) => {
      console.log(`An error occurred: ${err.message}`);
      mainWindow.webContents.send(
        'primaryStatus', `An error occurred: ${err.message}`
      );
      retry(joinVideoAudio);
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
    .videoFilters('scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2')
    .on('error', (err) => {
      console.log(`An error occurred: ${err.message}`);
      mainWindow.webContents.send(
        'primaryStatus', `An error occurred: ${err.message}`
      );
      retry(encode);
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
  // remove bad characters and non ascii from file name
  const name = path.basename(file, ext)
    .replace(/[/\\?%*:|"<>'"]/g, '-')
    .replace(/[^\x00-\x7F]/g, '-');

  return `${name}${ext}`;
}

function randomBetween(min, max) {
  return Math.random() * (+max - +min) + +min;
}

class ETA {
  eta(currentIter, totalIter) {
    if (!this.start) {
      this.start = Date.now();
    }

    const timeTaken = Date.now() - this.start;
    const timePerIter = timeTaken / currentIter;
    const iterLeft = totalIter - currentIter;
    const timeLeft = iterLeft * timePerIter;

    return timeLeft;
  }
}