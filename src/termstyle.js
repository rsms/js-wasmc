// terminal ANSI styling

export const stdoutStyle = getStyle(process.stdout)
export const stderrStyle = getStyle(process.stderr)

export function getStyle(s) {
  let ncolors = s.isTTY && s.hasColors() ? s.getColorDepth() : 0
  const sfn = (
    ncolors >= 8 ? (open16, open256, close) => {
      let a = '\x1b[' + open256 + 'm'
      let b = '\x1b[' + close + 'm'
      return s => a + s + b
    } :
    ncolors > 0 ? (open16, open256, close) => {
      let a = '\x1b[' + open16 + 'm'
      let b = '\x1b[' + close + 'm'
      return s => a + s + b
    } :
    () => s => s
  )
  return {
    ncolors,
    'reset'         : "\e[0m",
    // name               16c    256c                 close
    'bold'          : sfn('1',   '1',                 '22'),
    'italic'        : sfn('3',   '3',                 '23'),
    'underline'     : sfn('4',   '4',                 '24'),
    'inverse'       : sfn('7',   '7',                 '27'),
    'white'         : sfn('37',  '38;2;255;255;255',  '39'),
    'grey'          : sfn('90',  '38;5;244',          '39'),
    'black'         : sfn('30',  '38;5;16',           '39'),
    'blue'          : sfn('34',  '38;5;75',           '39'),
    'cyan'          : sfn('36',  '38;5;87',           '39'),
    'green'         : sfn('32',  '38;5;84',           '39'),
    'magenta'       : sfn('35',  '38;5;213',          '39'),
    'purple'        : sfn('35',  '38;5;141',          '39'),
    'pink'          : sfn('35',  '38;5;211',          '39'),
    'red'           : sfn('31',  '38;2;255;110;80',   '39'),
    'yellow'        : sfn('33',  '38;5;227',          '39'),
    'lightyellow'   : sfn('93',  '38;5;229',          '39'),
    'orange'        : sfn('33',  '38;5;215',          '39'),
  }
}
