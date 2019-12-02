// JavaScript imported into the WASM module
mergeInto(LibraryManager.library, {
  fun_from_js: function(a, b) {
    console.log("fun_from_js called from WASM with args:", a, b)
  },
})
