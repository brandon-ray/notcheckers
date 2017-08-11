'use strict';

[
    ['warn',  '\x1b[33m'],
    ['error', '\x1b[31m'],
    ['info',   '\x1b[35m'],
    ['log',   '\x1b[2m']
].forEach((pair) => {
    let method = pair[0], reset = '\x1b[0m', color = '\x1b[36m' + pair[1];
    console[method] = console[method].bind(console, color, method.toUpperCase(), reset);
});

process.on('uncaughtException', (err) => {
    console.error(new Date(), 'Uncaught Exception:', err.stack ? err.stack : err);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error(new Date(), 'Unhandled Rejection:', err.stack ? err.stack : err);
    process.exit(1);
});

const config = require('./config');
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const child_process = require('child_process');
const port = config.port;

app.use(express.static('public'));

const teamLimit = config.teams;
const width = 12;
const height = 12;
const boardBufferWidth = 4;
const boardBufferHeight = 2;
let board = [];
for (let y=0; y<height; y++) {
    let row = [];
    for (let x=0; x<width; x++) {
        if (teamLimit > 0 && y < boardBufferHeight && x >= boardBufferWidth && x < width-boardBufferWidth) {
            row.push(1);
        } else if (teamLimit > 1 && y >= height-boardBufferHeight && x >= boardBufferWidth && x < width-boardBufferWidth) {
            row.push(2);
        } else if (teamLimit > 2 && x < boardBufferHeight && y >= boardBufferWidth && y < height-boardBufferWidth) {
            row.push(3);
        } else if (teamLimit > 3 && x >= width-boardBufferHeight && y >= boardBufferWidth && y < height-boardBufferWidth) {
            row.push(4);
        } else {
            row.push(0);
        }
    }
    board.push(row);
}

let teamTurn = 1;
let users = {};
function getGameState() {
    return {
        board: board,
        teamTurn: teamTurn,
        users: users
    }
}

function nextTurn() {
    let teamCounts = {};
    for (let y = 0; y < board.length; y++) {
        let row = board[y];
        for (let x = 0; x < row.length; x++) {
            let val = row[x];
            if (teamCounts[val]) {
                teamCounts[val]++;
            } else {
                teamCounts[val] = 1;
            }
        }
    }

    let check = true;
    let limit = 0;
    while (check) {
        teamTurn++;
        if (teamTurn > teamLimit) {
            teamTurn = 1;
        }

        if (teamCounts[teamTurn] > 0) {
            check = false;
        }

        limit++;
        if (limit > teamLimit) {
            check = false;
        }
    }

    for (let i=0; i<Object.keys(teamCounts).length; i++) {
        let team = Object.keys(teamCounts)[i];
        let count = teamCounts[team];
        if (count === 1) {
            for (let y = 0; y < board.length; y++) {
                let row = board[y];
                for (let x = 0; x < row.length; x++) {
                    let val = row[x];
                    if (val == team) {
                        board[y][x] = 0;
                    }
                }
            }
            io.emit('eliminated', team);
        }
    }
}

io.use((socket, next) => {
    if (socket.handshake.query && socket.handshake.query.name && socket.handshake.query.name.length > 2 && socket.handshake.query.name.length < 50) {
        socket.name = socket.handshake.query.name;
        next();
    } else {
        next('Invalid name.');
    }
});

let teamCache = {};
let latestTeam = 1;
io.on('connection', (socket) => {
    let address = socket.handshake.headers['x-real-ip'] ? socket.handshake.headers['x-real-ip'] : socket.handshake.address;
    if (address.startsWith('::ffff:')) {
        address = address.replace('::ffff:', '');
    }

    if (users[address]) {
        console.error('Disconnecting user that is already connected:', address);
        socket.disconnect();
        return;
    }

    socket.on('disconnect', () => {
        delete users[address];
        console.log('Client disconnected:', address, socket.userState.team, socket.name);
        io.emit('gameState', getGameState());
    });

    let team = 0;
    if (teamCache[address]) {
        team = teamCache[address];
    } else {
        team = latestTeam;
        teamCache[address] = team;
        latestTeam++;
        if (latestTeam > teamLimit) {
            latestTeam = 1;
        }
    }

    users[address] = {
        team: team,
        name: socket.name
    };

    socket.userState = {
        team: team,
        name: socket.name
    };

    console.log('Client connected:', address, socket.userState.team, socket.name);

    socket.emit('userState', socket.userState);
    io.emit('gameState', getGameState());
    socket.emit('chat', {
        user: {
            team: 0,
            name: 'Server'
        },
        message: 'Welcome to Not Checkers!'
    });

    socket.on('chat', (message) => {
        if (!message || !message.length || message.length > 500) {
            return;
        }

        io.emit('chat', {
            user: socket.userState,
            message: message
        });
    });

    socket.on('move', (data) => {
        if (data.selected && data.to && socket.userState.team === teamTurn && board[data.to.y][data.to.x] === 0) {
            if (board[data.selected.y][data.selected.x] === socket.userState.team) {
                let jumped = false;
                let xdist = Math.abs(data.selected.x - data.to.x);
                let ydist = Math.abs(data.selected.y - data.to.y);

                if (xdist <= 1 && ydist <= 1) {
                    //Valid move.
                } else if (xdist === 2 && ydist === 0) {
                    let dx = (data.selected.x - data.to.x)/2;
                    let val = board[data.to.y][data.to.x + dx];
                    if (val === 0) {
                        return;
                    }
                    jumped = true;
                    board[data.to.y][data.to.x + dx] = 0;
                } else if (xdist === 0 && ydist === 2) {
                    let dy = (data.selected.y - data.to.y)/2;
                    let val = board[data.to.y + dy][data.to.x];
                    if (val === 0) {
                        return;
                    }
                    jumped = true;
                    board[data.to.y + dy][data.to.x] = 0;
                } else if (xdist === 2 && ydist === 2) {
                    let dx = (data.selected.x - data.to.x)/2;
                    let dy = (data.selected.y - data.to.y)/2;
                    let val = board[data.to.y + dy][data.to.x + dx];
                    if (val === 0) {
                        return;
                    }
                    jumped = true;
                    board[data.to.y + dy][data.to.x + dx] = 0;
                } else {
                    return;
                }

                board[data.selected.y][data.selected.x] = 0;
                board[data.to.y][data.to.x] = socket.userState.team;

                if (!jumped) {
                    nextTurn();
                }

                io.emit('gameState', getGameState());
            }
        }
    });
});

http.listen(port, () => {
    console.log('Listening on port:', port);
});
