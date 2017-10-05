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
const port = config.port;

app.use(express.static('public'));

const width = 12;
const height = 12;
const boardBufferWidth = 4;
const boardBufferHeight = 2;

function getTeamCounts(game) {
    if (!game.playing) {
        return false;
    }

    let teamCounts = {};

    for (let i=1; i<game.maxPlayers; i++) {
        teamCounts[i] = 0;
    }

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

    return teamCounts;
}

function nextTurn(game) {
    if (!game.playing) {
        return false;
    }

    let teamCounts = getTeamCounts(game);

    let check = true;
    let limit = 0;
    while (check) {
        game.teamTurn++;
        if (game.teamTurn > game.maxPlayers) {
            game.teamTurn = 1;
        }

        if (teamCounts[game.teamTurn] > 1) {
            check = false;
        }

        limit++;
        if (limit > game.maxPlayers*5) {
            check = false;
        }
    }

    checkGameStatus(game, teamCounts);
}

function checkGameStatus(game, teamCounts) {
    if (!game.playing) {
        return false;
    }

    if (!teamCounts) {
        teamCounts = getTeamCounts(game);
    }

    for (let team=1; team<=game.maxPlayers; team++) {
        let teamData = game.teamData[team];
        let count = teamCounts[team];
        if (!teamData.eliminated && count <= 1) {
            for (let y = 0; y < game.board.length; y++) {
                let row = game.board[y];
                for (let x = 0; x < row.length; x++) {
                    let val = row[x];
                    if (val == team) {
                        game.board[y][x] = 0;
                    }
                }
            }

            teamData.eliminated = true;
            io.to('game:' + game.id).emit('eliminated', team);

            checkWinConditions(game);
        }
    }
}

function checkWinConditions(game) {
    if (!game.playing) {
        return false;
    }

    let eliminatedCount = 0;
    let winner = 0;
    for (let team=1; team<=game.maxPlayers; team++) {
        let teamData = game.teamData[team];
        if (teamData.eliminated) {
            eliminatedCount++;
        } else {
            winner = team;
        }
    }

    if (eliminatedCount >= game.maxPlayers-1) {
        game.playing = false;
        io.to('game:' + game.id).emit('winner', winner);

        setTimeout(function() {
            let newGame = startNewGame(game.name, game.id, game.startData);

            let stillConnected = false;
            for (let i=0; i<game.users.length; i++) {
                let socket = io.sockets.connected[game.users[i].id];
                if (socket && socket.connected) {
                    stillConnected = true;
                    joinGame(socket, newGame.id, true);
                }
            }

            if (!stillConnected) {
                destroyGame(newGame.id);
            }
        }, 10000);
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
function startNewGame(name, existingId, data) {
    let game = {
        id: existingId ? existingId : parseInt(Math.random()*10000000),
        name: name,
        playing: true,
        users: [],
        teamSlots: {},
        teamData: {},
        maxPlayers: data.maxPlayers,
        teamTurn: 1,
        board: [],
        startData: data
    };

    for (let i=0; i<game.maxPlayers; i++) {
        game.teamData[i+1] = {
            eliminated: false
        };
    }

    for (let y=0; y<height; y++) {
        let row = [];
        for (let x=0; x<width; x++) {
            if (game.maxPlayers > 0 && y < boardBufferHeight && x >= boardBufferWidth && x < width-boardBufferWidth) {
                row.push(1);
            } else if (game.maxPlayers > 1 && y >= height-boardBufferHeight && x >= boardBufferWidth && x < width-boardBufferWidth) {
                row.push(2);
            } else if (game.maxPlayers > 2 && x < boardBufferHeight && y >= boardBufferWidth && y < height-boardBufferWidth) {
                row.push(3);
            } else if (game.maxPlayers > 3 && x >= width-boardBufferHeight && y >= boardBufferWidth && y < height-boardBufferWidth) {
                row.push(4);
            } else {
                row.push(0);
            }
        }
        game.board.push(row);
    }

    games[game.id] = game;

    return game;
}

function getGameState(game) {
    return {
        board: game.board,
        teamTurn: game.teamTurn,
        users: game.users
    };
}

function joinGame(socket, gameId, restarted) {
    let game = games[gameId];
    if (!game) {
        return false;
    }

    if (game.users.length+1 > game.maxPlayers) {
        return false;
    }

    let team = 1;
    for (let i=0; i<game.maxPlayers; i++) {
        if (!game.teamSlots[i+1]) {
            team = i+1;
            game.teamSlots[team] = true;
            break;
        }
    }

    socket.game = game.id;
    socket.userState = {
        team: team,
        name: socket.name
    };

    if (!restarted) {
        io.to('game:' + game.id).emit('chat', {
            user: {
                team: 0,
                name: 'Server'
            },
            message: socket.name + ' has joined the game.'
        });
    }

    game.users.push({
        id: socket.id,
        name: socket.name,
        team: team
    });

    socket.leave('lobby');
    socket.join('game:' + game.id);
    socket.emit('userState', socket.userState);
    io.to('game:' + game.id).emit('gameState', getGameState(game));

    if (!restarted) {
        socket.emit('chat', {
            user: {
                team: 0,
                name: 'Server'
            },
            message: 'Welcome to Not Checkers!'
        });
    }

    io.to('lobby').emit('lobbyState', getLobbyState());
}

function leaveGame(socket, gameId) {
    let game = games[gameId];
    if (!game) {
        return false;
    }

    socket.leave('game:' + game.id);
    socket.join('lobby');

    game.teamSlots[socket.userState.team] = false;

    for (let i=0; i<game.users.length; i++) {
        let user = game.users[i];
        if (user.id === socket.id) {
            game.users.splice(i, 1);
            break;
        }
    }

    if (game.users.length <= 0) {
        destroyGame(game.id);
    } else {
        io.to('game:' + game.id).emit('chat', {
            user: {
                team: 0,
                name: 'Server'
            },
            message: socket.name + ' has left the game.'
        });
    }

    io.to('lobby').emit('lobbyState', getLobbyState());
    io.to('game:' + game.id).emit('gameState', getGameState(game));
}

function destroyGame(gameId) {
    let game = games[gameId];
    if (!game) {
        return false;
    }

    delete games[game.id];
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
        clientCount: io.engine.clientsCount,
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

    socket.on('newGame', (data) => {
        if (socket.game) {
            return false;
        }

        let startData = {
            maxPlayers: 2
        };

        switch (data.maxPlayers) {
            case '2_players':
                startData.maxPlayers = 2;
                break;
            case '3_players':
                startData.maxPlayers = 3;
                break;
            case '4_players':
                startData.maxPlayers = 4;
                break;
        }

        let game = startNewGame(socket.name + '\'s Game', null, startData);
        joinGame(socket, game.id);
    });

    socket.on('joinGame', (gameId) => {
        if (socket.game) {
            return false;
        }
        joinGame(socket, gameId);
    });

    socket.on('joinRandomGame', () => {
        if (socket.game) {
            return false;
        }

        let foundGame = null;
        let gameIds = Object.keys(games);
        for (let i=0; i<gameIds.length; i++) {
            let game = games[gameIds[i]];
            if (game.users.length < game.maxPlayers) {
                foundGame = game;
                break;
            }
        }

        if (foundGame) {
            joinGame(socket, foundGame.id);
        } else {
            let game = startNewGame(socket.name + '\'s Game', null, {
                maxPlayers: 2
            });
            joinGame(socket, game.id);
        }
    });

    socket.on('chat', (message) => {
        if (!message || !message.length || message.length > 500) {
            return;
        }

        let game = games[socket.game];
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
