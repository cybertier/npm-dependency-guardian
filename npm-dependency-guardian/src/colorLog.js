"use strict";

const ANSI_START = String.fromCharCode(0x1B);
const ANSI_RESET = `${ANSI_START}[m`;
const fgColorMap = {
  black: '30',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  white: '37',
  brightBlack: '90',
  brightRed: '91',
  brightGreen: '92',
  brightYellow: '93',
  brightBlue: '94',
  brightMagenta: '95',
  brightCyan: '96',
  brightWhite: '97'
};
const bgColorMap = {
  black: '40',
  red: '41',
  green: '42',
  yellow: '43',
  blue: '44',
  magenta: '45',
  cyan: '46',
  white: '47',
  brightBlack: '100',
  brightRed: '101',
  brightGreen: '102',
  brightYellow: '103',
  brightBlue: '104',
  brightMagenta: '105',
  brightCyan: '106',
  brightWhite: '107'
};

function ansi_color(fgColor='white', bgColor='black') {
  return `${ANSI_START}[${fgColorMap[fgColor]};${bgColorMap[bgColor]}m`;
}

function log(message, fgColor='white', bgColor='black') {
  console.log(ansi_color(fgColor, bgColor) + message + ANSI_RESET);
}

module.exports = { log: log };
