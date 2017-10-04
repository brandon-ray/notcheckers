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

function nextTurn(game) {
    let teamCounts = {};
    for (let y = 0; y < game.board.length; y++) {
        let row = game.board[y];
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
        game.teamTurn++;
        if (game.teamTurn > teamLimit) {
            game.teamTurn = 1;
        }

        if (teamCounts[game.teamTurn] > 0) {
            check = false;
        }

        limit++;
        if (limit > teamLimit*5) {
            check = false;
        }
    }

    for (let i=0; i<Object.keys(teamCounts).length; i++) {
        let team = Object.keys(teamCounts)[i];
        let count = teamCounts[team];
        if (count === 1) {
            for (let y = 0; y < game.board.length; y++) {
                let row = game.board[y];
                for (let x = 0; x < row.length; x++) {
                    let val = row[x];
                    if (val == team) {
                        game.board[y][x] = 0;
                    }
                }
            }
            io.to('game:' + game.id).emit('eliminated', team);
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

let games = {};
function startNewGame(socket) {
    let game = {
        id: parseInt(Math.random()*10000000),
        name: socket.name + '\'s Game',
        users: [],
        maxPlayers: 2,
        latestTeam: 1,
        teamTurn: 1,
        board: []
    };

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
        game.board.push(row);
    }

    games[game.id] = game;

    joinGame(socket, game.id);
}

function getGameState(game) {
    return {
        board: game.board,
        teamTurn: game.teamTurn,
        users: game.users
    };
}

function joinGame(socket, gameId) {
    let game = games[gameId];
    if (!game) {
        return false;
    }

    if (game.users.length+1 > game.maxPlayers) {
        return false;
    }

    let team = game.latestTeam;
    game.latestTeam++;
    if (game.latestTeam > teamLimit) {
        game.latestTeam = 1;
    }

    socket.game = game.id;
    socket.userState = {
        team: team,
        name: socket.name
    };

    io.to('game:' + game.id).emit('chat', {
        user: {
            team: 0,
            name: 'Server'
        },
        message: socket.name + ' has joined the game.'
    });

    game.users.push(socket.id);
    socket.leave('lobby');
    socket.join('game:' + game.id);
    socket.emit('userState', socket.userState);
    io.to('game:' + game.id).emit('gameState', getGameState(game));
    socket.emit('chat', {
        user: {
            team: 0,
            name: 'Server'
        },
        message: 'Welcome to Not Checkers!'
    });

    io.to('lobby').emit('lobbyState', getLobbyState());
}

function leaveGame(socket, gameId) {
    let game = games[gameId];
    if (!game) {
        return false;
    }

    socket.leave('game:' + game.id);
    socket.join('lobby');

    for (let i=0; i<game.users.length; i++) {
        var user = game.users[i];
        if (user === socket.id) {
            game.users.splice(i, 1);
            break;
        }
    }

    if (game.users.length <= 0) {
        delete games[game.id];
    }

    io.to('lobby').emit('lobbyState', getLobbyState());
}

function getLobbyState() {
    let lobbyGames = [];
    let gameIds = Object.keys(games);
    for (let i=0; i<gameIds.length; i++) {
        let game = games[gameIds[i]];
        lobbyGames.push({
            id: game.id,
            name: game.name,
            players: game.users.length,
            maxPlayers: game.maxPlayers
        });
    }
    return {
        clientCount: io.sockets.sockets.length,
        games: lobbyGames
    };
}

io.on('connection', (socket) => {
    let address = socket.handshake.headers['x-real-ip'] ? socket.handshake.headers['x-real-ip'] : socket.handshake.address;
    if (address.startsWith('::ffff:')) {
        address = address.replace('::ffff:', '');
    }

    socket.on('disconnect', () => {
        leaveGame(socket, socket.game);
        console.log('Client disconnected:', address, socket.name);
    });

    console.log('Client connected:', address, socket.name);

    socket.join('lobby');
    socket.emit('lobbyState', getLobbyState());

    socket.on('newGame', () => {
        if (socket.game) {
            return false;
        }
        startNewGame(socket);
    });

    socket.on('joinGame', (gameId) => {
        if (socket.game) {
            return false;
        }
        joinGame(socket, gameId);
    });

    socket.on('chat', (message) => {
        if (!message || !message.length || message.length > 500) {
            return;
        }

        var game = games[socket.game];
        if (!game) {
            return false;
        }

        io.to('game:' + game.id).emit('chat', {
            user: socket.userState,
            message: message
        });
    });

    socket.on('move', (data) => {
        let game = games[socket.game];
        if (!game) {
            socket.disconnect();
            return false;
        }

        if (data.selected && data.to && socket.userState.team === game.teamTurn && game.board[data.to.y][data.to.x] === 0) {
            if (game.board[data.selected.y][data.selected.x] === socket.userState.team) {
                let jumped = false;
                let xdist = Math.abs(data.selected.x - data.to.x);
                let ydist = Math.abs(data.selected.y - data.to.y);

                if (xdist <= 1 && ydist <= 1) {
                    //Valid move.
                } else if (xdist === 2 && ydist === 0) {
                    let dx = (data.selected.x - data.to.x)/2;
                    let val = game.board[data.to.y][data.to.x + dx];
                    if (val === 0) {
                        return;
                    }
                    jumped = true;
                    game.board[data.to.y][data.to.x + dx] = 0;
                } else if (xdist === 0 && ydist === 2) {
                    let dy = (data.selected.y - data.to.y)/2;
                    let val = game.board[data.to.y + dy][data.to.x];
                    if (val === 0) {
                        return;
                    }
                    jumped = true;
                    game.board[data.to.y + dy][data.to.x] = 0;
                } else if (xdist === 2 && ydist === 2) {
                    let dx = (data.selected.x - data.to.x)/2;
                    let dy = (data.selected.y - data.to.y)/2;
                    let val = game.board[data.to.y + dy][data.to.x + dx];
                    if (val === 0) {
                        return;
                    }
                    jumped = true;
                    game.board[data.to.y + dy][data.to.x + dx] = 0;
                } else {
                    return;
                }

                game.board[data.selected.y][data.selected.x] = 0;
                game.board[data.to.y][data.to.x] = socket.userState.team;

                if (!jumped) {
                    nextTurn(game);
                }

                let state = getGameState(game);
                state.move = {
                    from: data.selected,
                    to: data.to
                };
                io.to('game:' + game.id).emit('gameState', state);
            }
        }
    });
});

http.listen(port, () => {
    console.log('Listening on port:', port);
});
