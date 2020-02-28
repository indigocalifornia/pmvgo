
# PMV-Go

An app for PMV generation.

# Description

Given a collection of videos and a music file, this app will generate a PMV synced to the beat of the music. Here is a brief algorithm of how it's done:
- Break each video into a small segment with the duration falling exactly between two beats.
- Merge the resulting segments together and overlay the music.

Currently, the app only has the basic functionality of [pmvc](https://github.com/indigocalifornia/pmvc)
. More features will be implemented, given there is interest.

# Parameters
**Source directory**: Directory where all the video files for the PMV are. Only keep video files here. If there are many files here, the segmentation step may take a long time, since each file needs to be broken down into segments.

**Temporary directory**: Directory where temporary files will be kept. These files are *not* automatically deleted, since the final file also resides here. Click "Delete files" to delete all files once no longer needed.

**Audio file**: Audio file to be used. Most formats should be supported. If the audio is long, the processing step may take a long time, since many segments will have to be stitched together to fill the entire duration.

**BPM**: You need to know bpm of the audio.

**Scene duration**: This is the number of beats you want each segment to span. The higher it is, less rapid the compilation will feel. Use 1, 2 or 4 for best result.

**Offset**: If final video is out of sync with the audio, which can happen if the audio doesn't start on the beat precisely, use this to regenerate the compilation, once you know the A-V delay.

# Notes
- Final output is hardcoded to 720p.
