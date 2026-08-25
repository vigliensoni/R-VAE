const fs = require('fs');
const utils = require('./utils.js');
const Max = require('max-api');

const COLS = require('./constants.js').COLS;
const ROWS = require('./constants.js').ROWS;
const LOOP_DURATION = require('./constants.js').LOOP_DURATION;
const NUM_DRUM_CLASSES = require('./constants.js').NUM_DRUM_CLASSES;
const INST_SIDE = Math.sqrt(NUM_DRUM_CLASSES); // 3,  SIDE OF THE INSTRUMENT CUBE
const Px = 1; // SCALING FACTOR, 10 for WEB, 1 for MAXMSP
const height = ROWS * INST_SIDE * Px;
const width = COLS * INST_SIDE * Px;
const matlength = NUM_DRUM_CLASSES * LOOP_DURATION * COLS * ROWS;

const vae = require('./vae.js');

let matrix = new Float32Array(matlength);  // original LS sampled
let matrix2 = new Float32Array(matlength); // space over time
let matrix3 = new Uint8ClampedArray(ROWS * INST_SIDE * COLS * INST_SIDE * LOOP_DURATION * Px * Px * 4); // scaled matrix, 4 is due to Uint8ClampedArray bytes
let matrix4 = new Array(); // same as `matrix3`, but snapshots over time.
let red = new Array(); // RED pixels only, over time

let visualizationDict = {}; // output matrix w/visualizer data


// async function generateVisualization(model) {
//   utils.post('Generate visualization:' + model)
// }

async function createMatrix(path){

  // MATRIX 1
  // This matrix will store the values from latent space for a given (ROW, COL) 
  // resolution in the format that VAE provides. That is, for each (r e ROW) and (c e COL) 
  // i1_t1, i1_t2, ... , i1_tT (i.e., instrument 1 on time 1, ... )
  // i2_t1, i2_t2, ... , i2_tT
  // iI_t1, iI_t2, ... , iI_tT
  utils.log_status("Creating matrix1");
  
  // let matrix = new Float32Array(ROWS*COLS*LOOP_DURATION*NUM_DRUM_CLASSES) 
  // utils.log_status("matrix length: " + ml);

  let normalize = (x, max, scaleToMax) => (x/max - 0.5) * 2 * scaleToMax

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      //   normalize samples to ±3. Inverse r allows start from [-3, 3] instead of [-3, -3]
      let r_norm = normalize(r, ROWS, 3) * -1   
      let c_norm = normalize(c, COLS, 3)        
      let [onsets, velocities, timeshifts] = vae.generatePattern(c_norm, r_norm, 0);
      for (let i = 0; i < NUM_DRUM_CLASSES; i++) {
          // This iterates over instruments, columns, and rows, given a loop duration length. 
          // If NUM_DRUM_CLASSES and LOOP_DURATION are one, the iteration increases one by one over columns and rows.
          matrix.set(onsets[i], ((COLS * r + c) * NUM_DRUM_CLASSES + i) * LOOP_DURATION )

        }
    }
  } 
  
  if (path) fs.writeFileSync(path + '-matrix-LS.data', matrix)


  // MATRIX 2
  // This matrix stores the values from latent space to facilitate rendering
  // an image. That is, the outer loop is time, inside each moment we see an image:
  // i1_c0_r0, i2_c0_r0, ...,  i1_c1_r0, i2_c1_r0
  // i3_c0_r0, i4_c0_r0, ...,  i3_c1_r0, i3_c1_r0
  // i1_c0_r1, i2_c0_r1, ...,  i1_c1_r1, i2_c1_r1
  // i3_c0_r1, i4_c0_r1, ...,  i3_c1_r1, i3_c1_r1
  
  utils.log_status("Creating matrix2");

  let counter = 0;
  let instSide = Math.sqrt(NUM_DRUM_CLASSES)
  for (let t = 0; t < LOOP_DURATION; t++) {
      for (let r = 0; r < ROWS; r++) {
          for (let i2 = 0; i2 < instSide; i2++) {
              for (let c = 0; c < COLS; c++) {
                  for (let i1 = 0; i1 < instSide; i1++) {
                      let pos = ( i1 * LOOP_DURATION  ) + 
                              ( c * NUM_DRUM_CLASSES * LOOP_DURATION ) + 
                              ( i2 * LOOP_DURATION * instSide  ) +  
                              ( r * NUM_DRUM_CLASSES * LOOP_DURATION * COLS ) + 
                              t
                      matrix2[counter] = matrix[pos]
                      counter++
                  }
              }
          }
      }
  }


  // utils.log_status("matrix2: " + matrix2 );
  if (path) fs.writeFileSync(path + '-matrix-vis.data', matrix2)

  buildVisualization()
}

// ///////////////////////////////////////
// SCALE THE MATRIX TO ANY DESIRED SIZE
// Scaling factor is given by Px. Image is converted to Uint8ClampedArray,
// then split into RGBA channels per timestep into `visualizationDict`.
// Reused by both createMatrix (freshly generated matrix2) and loadMatrix
// (matrix2 loaded from a previously saved -matrix-vis.data file).
// ///////////////////////////////////////
function buildVisualization() {

  function scaleMatrix(t, r, c, pos, val) {
    // scale the matrix given the factor Px
    for(let y = 0; y < Px; y++) {
      for(let x = 0; x < Px; x++) {
        idx = x * 4 +
          y * ( 4 * COLS * INST_SIDE * Px ) +
          r * ( 4 * COLS * INST_SIDE * Px * Px) +
          c * ( Px * 4 ) +
          t * ( COLS * INST_SIDE * ROWS * INST_SIDE * Px * Px * 4 )
        if (val >= 0 && pos%INST_SIDE == 0) matrix3.set([val*255, 0, 0, 255], idx)
        else if (val >= 0 && pos%INST_SIDE == 1) matrix3.set([0, val*255, 0, 255], idx)
        else if (val >= 0 && pos%INST_SIDE == 2) matrix3.set([0, 0, val*255, 255], idx)
      }
    }
  }

  let pos;
  let val;
  let idx;
  // Iterate over all points
  for(let t = 0; t < LOOP_DURATION; t++) {
    for(let r = 0; r < ROWS * INST_SIDE; r++) {
      for(let c = 0; c < COLS * INST_SIDE; c++) {
          pos = r * COLS * INST_SIDE + c + t * ROWS * INST_SIDE * COLS * INST_SIDE
          val = matrix2[pos]
          scaleMatrix(t, r, c, pos, val)
      }
    }
  }

  utils.log_status("Creating Matrix 3")
  generateRGB()

  function generateRGB() {
    // Split matrix3 into RGBA channels
    for (let t = 0; t < LOOP_DURATION; t++) {
      matrix4 = matrix3.slice(width * height * 4 * (t), width * height * 4 * (t + 1));

      visualizationDict[t] = {'r': Array.from(matrix4.filter((value, index) => (index % 4 == 0))),
                              'g': Array.from(matrix4.filter((value, index) => (index % 4 == 1))),
                              'b': Array.from(matrix4.filter((value, index) => (index % 4 == 2))),
                              'a': Array.from(matrix4.filter((value, index) => (index % 4 == 3))),
      }
    }
  }
}

// Load a previously saved `<path>-matrix-vis.data` (matrix2, written by
// createMatrix) instead of regenerating it from the model's latent space.
function loadMatrix(path) {
  utils.log_status("Loading visualization matrix: " + path);
  let raw = fs.readFileSync(path + '-matrix-vis.data');
  let numFloats = raw.length / Float32Array.BYTES_PER_ELEMENT;
  if (numFloats !== matlength) {
    utils.error_status("Visualization file doesn't match current ROWS/COLS/LOOP_DURATION (expected "
      + matlength + " values, got " + numFloats + "). It was likely saved with different constants.js values.");
    return;
  }
  matrix2 = new Float32Array(raw.buffer, raw.byteOffset, numFloats);
  buildVisualization();
}

function displayMatrix(t) {
  Max.outlet('visualizer', visualizationDict[t])
}

exports.matrix3 = matrix3;
exports.red = red;
exports.createMatrix = createMatrix;
exports.loadMatrix = loadMatrix;
exports.displayMatrix = displayMatrix;
// exports.generateVisualization = generateVisualization;
