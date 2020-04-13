const { rustcCmd, wasmGCCmd, tempDir, wasmBindgenCmd, wasmBindgenDeps } = require("../config.js");
const { exec, joinCmd, exists, writeFile, readFile, unlink, mkdir } = require("./common.js");

async function wasmGC(wasmFile, callback) {
  if (!(await exists(wasmFile))) {
    throw new Error("wasm is not found");
  }
  await exec(joinCmd([wasmGCCmd, wasmFile]));
}

async function rustc(tar, options = {}) {
  // let crateName = 'rustc_h_' + Math.random().toString(36).slice(2);
  // let baseName = tempDir + '/' + crateName;
  // let rustFile = baseName + '.rs';
  // let wasmFile = baseName + '.wasm';
  // await writeFile(rustFile, source);

  let crateName = "rustc_h_" + Math.random().toString(36).slice(2);
  let crateDir = tempDir + "/" + crateName;

  await mkdir(crateDir);

  let rustTar = crateDir + "/" + "lib.tar";
  let wasmFile = crateDir + "/" + "lib.wasm";

  await writeFile(rustTar, Buffer.from(tar, "base64").toString("ascii"));

  let args = ["tar", "xvf", rustTar, "-C", crateDir];
  await exec(joinCmd(args));

  const rustFile = crateDir + "/src/" + "lib.rs";

  try {
    let args = [rustcCmd, rustFile];
    args.push("--target=wasm32-unknown-unknown");
    args.push("--crate-type=cdylib");
    if (options.lto) args.push("-Clto");
    if (options.debug) args.push("-g");
    switch (options.opt_level) {
      case "s":
      case "z":
      case "0":
      case "1":
      case "2":
      case "2":
        args.push("-Copt-level=" + options.opt_level);
        break;
    }
    args.push("-o");
    args.push(wasmFile);
    for (let i = 0; i < wasmBindgenDeps.length; i++) {
      args.push("-L");
      args.push(wasmBindgenDeps[i]);
    }
    let output;
    let success = false;
    let opts = {
      // env vars needed for #[wasm_bindgen]
      env: {
        CARGO_PKG_NAME: "main",
        CARGO_PKG_VERSION: "1.0.0",
      },
    };

    try {
      output = await exec(joinCmd(args), opts);
      success = true;
    } catch (e) {
      console.log("args", joinCmd(args));
      output = "error: " + e;
    }

    try {
      if (!success) return { success, output: "", message: output };
      let wasmBindgenJs = "";

      let wasm = await readFile(wasmFile);

      let m = await WebAssembly.compile(wasm);

      let ret = { success, message: output };
      if (WebAssembly.Module.customSections(m, "__wasm_bindgen_unstable").length !== 0) {
        await exec(joinCmd([wasmBindgenCmd, wasmFile, "--no-modules", "--out-dir", crateDir]));
        wasm = await readFile(crateDir + "/lib_bg.wasm");
        ret.wasmBindgenJs = (await readFile(crateDir + "/lib.js")).toString();
      } else {
        await exec(joinCmd([wasmGCCmd, wasmFile]));
        wasm = await readFile(wasmFile);
      }
      ret.output = wasm.toString("base64");
      return ret;
    } catch (e) {
      console.log("error", e);
    } finally {
      if (success) await unlink(wasmFile);
    }
  } finally {
    // await unlink(crateDir);
  }
}

module.exports = function (source, options, callback) {
  rustc(source, options)
    .then((result) => callback(null, result))
    .catch((err) => callback(err, null));
};
