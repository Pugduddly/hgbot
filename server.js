var cluster = require('cluster');
if (cluster.isMaster) {
    cluster.fork();

    cluster.on('exit', function(worker, code, signal) {
      cluster.fork();
    });
}

if (cluster.isWorker) {
    const low = require('lowdb');
    const FileSync = require('lowdb/adapters/FileSync');

    const adapter = new FileSync('db.json');
    const db = low(adapter);

    const fs = require('fs');

	const Discord = require('discord.js');
	const client = new Discord.Client();
    const config = require('./config.json');
    const events = require('./events.json');

    const helpMsgs = [
        { category: 0, name: 'start', message: 'Starts a Hunger Games simulation', aliases: [] },
        { category: 0, name: 'stop', message: 'Stops a Hunger Games simulation', aliases: [] },
        { category: 0, name: 'status', message: 'Gets the status of the currently running simulation if there is one', aliases: [] },
        { category: 0, name: 'gender', message: 'Sets your gender (default is none)', aliases: [] },
        { category: 1, name: 'banana', message: 'banana', aliases: [] },
        { category: 1, name: 'help', message: 'Displays all the available commands, or a description of a specific command', aliases: [] }
    ];

    const debug = false;

    function log(message) {
        if (debug) console.log(message);
    }

    let games = {};

    db.defaults({
        serverconfigs: {},
        genders: {}
    }).write()

	client.on('ready', () => {
		client.user.setActivity(' ' + config.prefix + 'help', { type: 'LISTENING' });
    });
    
    function sendEmbedMsg(channel, text, img) {
        let attachment = undefined;
        
        let embed = new Discord.RichEmbed()
            .setColor('#977161')
            .setTitle(text)
            .setTimestamp()
            .setFooter(client.user.username, client.user.avatarURL);

        if (img !== undefined)
            embed = embed.attachFile(attachment).setImage(img);

        return channel.send(embed);
    }

    function getPlacement(player) {
        let placement = player.placement;
        if (placement === 1) return '1st';
        else if (placement === 2) return '2nd';
        else if (placement === 3) return '3rd';
        else return placement + 'th';
    }

    function sendPlayerList(channel, title, playerList, placement) {
        let embed = new Discord.RichEmbed()
            .setColor('#977161')
            .setTitle(title)
            .setTimestamp()
            .setFooter(client.user.username, client.user.avatarURL);
        
        let districtList = [];
        let numDistricts = 0;
        
        for (let i = 0; i < playerList.length; i ++)
            if (numDistricts < playerList[i].district) {
                numDistricts = playerList[i].district;
                districtList.push([]);
            }

        for (let i = 0; i < playerList.length; i ++)
            districtList[playerList[i].district - 1].push(playerList[i]);

        for (let i = 0; i < districtList.length; i ++) {
            if (placement)
                embed.addField('District ' + (i + 1),
                    '**' + districtList[i][0].name + '** (' + getPlacement(districtList[i][0]) + ' place, ' + (districtList[i][0].kills || 0) + ' kills)\n' +
                    '**' + districtList[i][1].name + '** (' + getPlacement(districtList[i][1]) + ' place, ' + (districtList[i][1].kills || 0) + ' kills)', true);
            else
                embed.addField('District ' + (i + 1),
                    '**' + districtList[i][0].name + (districtList[i][0].alive ? '** (Alive' + (districtList[i][0].kills > 0 ? ' ' + districtList[i][0].kills + ' kills' : '') + ')' : '** (Dead)') + '\n' +
                    '**' + districtList[i][1].name + (districtList[i][1].alive ? '** (Alive' + (districtList[i][1].kills > 0 ? ' ' + districtList[i][1].kills + ' kills' : '') + ')' : '** (Dead)'), true);
        }

        return channel.send(embed);
    }

    function replaceGenderText(text, textToReplace, mText, fText, nText, gender) {
        return text.replace(new RegExp('\\(' + textToReplace + '\\)', 'g'), gender === 'f' ? fText : (gender === 'm' ? mText : nText));
    }

    function doEvents(channel, game, eventName, hasFatal, day, title) {
        let playerList = game.players;
        let title2 = title;
        let eventList = events[eventName];
        let eventListFatal = events[eventName + 'Fatal'];
        let playersLeft = [].concat(playerList);
        let text = [ '' ];

        if (eventName === 'arena') {
            let eventId = Math.floor(Math.random() * events[eventName].length);
            let arenaEvent = events[eventName][eventId];
            eventList = arenaEvent.events;
            title2 = '**' + arenaEvent.text + '**';
            log('event ' + eventName + '[' + eventId + ']');
        } else {
            log('event ' + eventName);
        }

        if (eventName === 'fallen') {
            playersLeft = [];
            title2 = game.fallen.length + ' cannon shots can be heard in the distance.';
            
            if (game.fallen.length === 0)
                text = [ 'Nobody died.' ];
            else
                for (let i = 0; i < game.fallen.length; i ++) {
                    let fallenText = '**' + game.fallen[i].name + '**\nDistrict ' + game.fallen[i].district;
                    if (i < game.fallen.length - 1) fallenText += '\n';

                    if (text[text.length - 1].length + fallenText.length < 1024)
                        text[text.length - 1] += fallenText + '\n';
                    else
                        text.push(fallenText + '\n');
                }

            game.fallen = [];
        }

        let alivePlayers = [];
        for (let i = 0; i < playersLeft.length; i ++)
            if (playersLeft[i].alive)
                alivePlayers.push(playersLeft[i]);

        while (playersLeft.length > 0 && alivePlayers.length > 1) {
            let eventId = Math.floor(Math.random() * eventList.length);
            let event = eventList[eventId];
            let isEventFatal = false;

            if (Math.random() < .1 + (game.arenaHappened ? .5 : 0) + (game.feastHappened ? .5 : 0) + .01 * day && hasFatal) {
                isEventFatal = true;
                eventId = Math.floor(Math.random() * eventList.length);
                event = eventListFatal[eventId];
            }

            alivePlayers = [];
            for (let i = 0; i < playersLeft.length; i ++)
                if (playersLeft[i].alive)
                    alivePlayers.push(playersLeft[i]);
            
            if (event.tributes > alivePlayers.length) {
                log('not enough alive players (alive ' + alivePlayers.length + ', needed ' + event.tributes + '), picking different event');
                continue;
            }

            if ((event.killed || []).length === alivePlayers.length) {
                log('event kills everyone, skipping event');
            }

            let oldPlayersLeft = [].concat(playersLeft);
            let eventPlayers = [];
            for (let i = 0; i < event.tributes; i ++) {
                let player = playersLeft.splice(Math.floor(Math.random() * playersLeft.length), 1)[0];
                while (!player.alive) {
                    player = playersLeft.splice(Math.floor(Math.random() * playersLeft.length), 1)[0];
                }
                eventPlayers.push(player);
            }

            if ((event.requires || []).length > 0) {
                log('event ' + eventName + (isEventFatal ? 'Fatal' : '') + '[' + eventId + '] requires ' + event.requires);

                let meetsRequirements = false;

                for (let i = 0; i < eventPlayers.length; i ++) {
                    let player = eventPlayers[i];
                    let invRequirementsMet = 0;
                    for (let k = 0; k < event.requires.length; k ++)
                        if (event.requires[k].startsWith('!') && !player.inventory.includes(event.requires[k]))
                            invRequirementsMet ++;
                        else if (player.inventory.includes(event.requires[k]))
                            invRequirementsMet ++;
                    if (invRequirementsMet === event.requires.length) {
                        log('player ' + (i + 1) + ' (' + player.name + ') meets requirements (' + event.requires.join(', ') + ')');
                        meetsRequirements = true;
                        break;
                    }
                }

                if (!meetsRequirements) {
                    log('requirements not met, picking different event');
                    playersLeft = oldPlayersLeft;
                    continue;
                }
            }

            if ((event.requiredStatus || []).length > 0) {
                log('event ' + eventName + (isEventFatal ? 'Fatal' : '') + '[' + eventId + '] requires status ' + event.requiredStatus);

                let requirementsMet = 0;
                let numRequirements = 0;

                for (let i = 0; i < event.requiredStatus.length; i ++) {
                    let requiredStatus = event.requiredStatus[i].split(':');
                    let player = eventPlayers[parseInt(requiredStatus[0]) - 1];

                    numRequirements ++;
                    if (requiredStatus[1].startsWith('!') && player.status !== requiredStatus[1])
                        requirementsMet ++;
                    else if (player.status === requiredStatus[1])
                        requirementsMet ++;
                }

                if (numRequirements !== requirementsMet) {
                    log('status requirements not met, picking different event');
                    playersLeft = oldPlayersLeft;
                    continue;
                }
            }

            let eventText = event.text;
            for (let i = 0; i < eventPlayers.length; i ++) {
                eventText = eventText.replace(new RegExp('\\(Player' + (i + 1) + '\\)', 'g'), '**' + eventPlayers[i].name + '**');
                eventText = replaceGenderText(eventText, 'him/her' + (i + 1), 'him', 'her', 'them', eventPlayers[i].gender);
                eventText = replaceGenderText(eventText, 'his/her' + (i + 1), 'his', 'her', 'their', eventPlayers[i].gender);
                eventText = replaceGenderText(eventText, 'he/she' + (i + 1), 'he', 'she', 'they', eventPlayers[i].gender);
                eventText = replaceGenderText(eventText, 'he is/she is' + (i + 1), 'he is', 'she is', 'they are', eventPlayers[i].gender);
                eventText = replaceGenderText(eventText, 'He/She' + (i + 1), 'He', 'She', 'They', eventPlayers[i].gender);
                eventText = replaceGenderText(eventText, 'himself/herself' + (i + 1), 'himself', 'herself', 'themself', eventPlayers[i].gender);
            }
            if (text[text.length - 1].length + eventText.length < 1024)
                text[text.length - 1] += eventText + '\n';
            else
                text.push(eventText + '\n');

            if (event.killer !== undefined)
                for (let i = 0; i < event.killer.length; i ++)
                    eventPlayers[event.killer[i] - 1].kills ++;
            let placement = alivePlayers.length;
            if (event.killed !== undefined)
                for (let i = 0; i < event.killed.length; i ++) {
                    eventPlayers[event.killed[i] - 1].alive = false;
                    eventPlayers[event.killed[i] - 1].placement = placement --;
                    game.fallen.push(eventPlayers[event.killed[i] - 1]);
                }
            
            let actions = event.action || [];
            for (let i = 0; i < actions.length; i ++) {
                let action = actions[i].split(':');
                if (action[1] === 'get') {
                    log('giving player ' + action[0] + ' ' + action[2])
                    eventPlayers[parseInt(action[0]) - 1].inventory.push(action[2]);
                }
            }

            let statuses = event.status || [];
            for (let i = 0; i < statuses.length; i ++) {
                let status = statuses[i].split(':');
                log('giving player ' + status[0] + ' status ' + status[1])
                eventPlayers[parseInt(status[0]) - 1].status = status[1];
            }

            for (let i = 0; i < playerList.length; i ++)
                for (let j = 0; j < eventPlayers.length; j ++)
                    if (eventPlayers[j].name === playerList[i].name)
                        playerList[i] = eventPlayers.splice(j, 1)[0];
        }

        log(text);
        
        let embed = new Discord.RichEmbed()
            .setColor('#977161')
            .setTitle(title)
            .setTimestamp()
            .setFooter(client.user.username, client.user.avatarURL);
        
        for (let i = 0; i < text.length; i ++)
            if (text.length > 1)
                embed.addField(title2 + ' (' + (i + 1) + '/' + text.length + ')', text[i]);
            else if (text[i].length > 0)
                embed.addField(title2, text[i]);

        return channel.send(embed);
    }

    function reactAndWait(promise, filter, callback) {
        if (filter === undefined) filter = () => true;
        const filter2 = (reaction, user) => reaction.emoji.name === '▶️' && filter(reaction, user);
        promise.then((message) => {
            message.react('▶️').then(() => {
                let collector = message.createReactionCollector(filter2, { time: 60000 });
                let ended = false;
                collector.on('collect', () => {
                    ended = true;
                    collector.stop();
                    callback();
                });
                collector.on('end', () => {
                    if (!ended)
                        callback();
                });
            });
        });
    }
    
    function nextEvent(channel, game, eventCount, lastEvent) {
        if (game === undefined || games[channel.guild.id] === undefined)
            return;
        
        const filter = (reaction, user) => user.id !== client.user.id;

        let alivePlayers = [];
        for (let i = 0; i < game.players.length; i ++)
            if (game.players[i].alive)
                alivePlayers.push(game.players[i]);
        
        if (alivePlayers.length === 1) {
            reactAndWait(sendEmbedMsg(channel, 'The winner is ' + alivePlayers[0].name + ' from district ' + alivePlayers[0].district + '!', alivePlayers[0].image), filter, () => {
                sendPlayerList(channel, 'Placements', game.players, true).then(() => {
                    delete games[channel.guild.id];
                    sendEmbedMsg(channel, 'Simulation is over!');
                });
            });

            return;
        }

        let event = '';

        if (eventCount === 0) event = 'bloodbath';
        if (eventCount === 1) event = 'day';

        if (eventCount > 1 && (lastEvent === 'night' || lastEvent === 'feast')) { event = 'day'; game.day ++ }
        if (eventCount > 1 && (lastEvent === 'day' || lastEvent === 'arena')) event = 'fallen';
        if (eventCount > 1 && lastEvent === 'fallen') event = 'night';

        if (eventCount >= 15 && lastEvent === 'night' && Math.random() < 0.333 && !game.feastHappened) { event = 'feast'; game.feastHappened = true };
        if (eventCount >= 15 && lastEvent === 'day' && Math.random() < 0.333 && !game.arenaHappened) { event = 'arena'; game.arenaHappened = true };

        let title = '';

        if (event === 'bloodbath') title = 'The Bloodbath';
        if (event === 'day') title = 'Day ' + game.day;
        if (event === 'fallen') title = 'Fallen Tributes ' + game.day;
        if (event === 'night') title = 'Night ' + game.day;
        if (event === 'arena') title = 'Arena Event';
        if (event === 'feast') title = 'The Feast';

        reactAndWait(doEvents(channel, game, event, event === 'arena' ? false : true, 1, title), filter, () => {
            //reactAndWait(sendPlayerList(channel, 'wtf is this one called', game.players), filter, () => {
                nextEvent(channel, game, ++ eventCount, event);
            //});
        });
    }

    async function runSimulation(channel, game) {
        const filter = (reaction, user) => user.id !== client.user.id;

        reactAndWait(sendPlayerList(channel, 'The Reaping', game.players), filter, () => {
            nextEvent(channel, game, 0);
        });
    }

	client.on('message', async message => {
		if (message.content.indexOf(config.prefix) !== 0) return;
		if (!message.guild || message.author === client.user) return;
		let args = message.content.slice(config.prefix.length).trim().split(/ +/g);
		const command = args.shift().toLowerCase();
		
        if (command === 'help') {
            if (args.length == 0) {
                let commands1 = '';
                let commands2 = '';

                for (let i = 0; i < helpMsgs.length; i ++) {
                    let msg = helpMsgs[i];

                    if (msg.category === 0)
                        commands1 += config.prefix + msg.name + ', ';
                    else
                        commands2 += config.prefix + msg.name + ', ';
                }
        
                const helpEmbed = new Discord.RichEmbed()
                    .setColor('#977161')
                    .setTitle('**' + client.user.username + ' Help**')
                    .setThumbnail(client.user.avatarURL)
                    .addField('Commands for ' + client.user.username + ':', commands1.substring(0, commands1.length - 2))
                    .addField('Other commands:', commands2.substring(0, commands2.length - 2))
                    .addField('Created by:', 'Pugduddly#6538', true)
                    .addField('Tip:', 'Type `' + config.prefix + 'help <command name>` for detailed help on a command.', true)
                    .setTimestamp()
                    .setFooter(client.user.username, client.user.avatarURL);
        
                message.channel.send(helpEmbed);
            } else {
                let msg = {};

                if (args[0].startsWith(config.prefix))
                    args[0] = args[0].substring(2, args[0].length);

                for (let i = 0; i < helpMsgs.length; i ++) {
                    if (helpMsgs[i].name == args[0]) {
                        msg = helpMsgs[i];
                        break;
                    }
                }

                if (msg === {} || msg.name === undefined) {
                    const helpEmbed = new Discord.RichEmbed()
                        .setColor('#977161')
                        .setTitle('**' + client.user.username + ' Help**')
                        .setThumbnail(client.user.avatarURL)
                        .addField('Help for ' + config.prefix + args[0], 'That command doesn\'t exist!')
                        .setTimestamp()
                        .setFooter(client.user.username, client.user.avatarURL);

                    message.channel.send(helpEmbed);
                } else {
                    const helpEmbed = new Discord.RichEmbed()
                        .setColor('#977161')
                        .setTitle('**' + client.user.username + ' Help**')
                        .setThumbnail(client.user.avatarURL)
                        .addField('Help for ' + config.prefix + msg.name, msg.message)
                        .setTimestamp()
                        .setFooter(client.user.username, client.user.avatarURL);

                    if (msg.aliases != undefined && msg.aliases.length > 0) {
                        helpEmbed.addField('Aliases', config.prefix + msg.aliases.join(', ' + config.prefix));
                    }

                    message.channel.send(helpEmbed);
                }
            }
        } else if (command === 'banana') {
        	message.channel.send('https://i5.walmartimages.com/asr/209bb8a0-30ab-46be-b38d-58c2feb93e4a_1.1a15fb5bcbecbadd4a45822a11bf6257.jpeg');
        } else if (command === 'start') {
            if (games[message.guild.id] !== undefined) {
                if (games[message.guild.id].host !== message.author.id || games[message.guild.id].started) {
                    sendEmbedMsg(message.channel, 'There is already a Hunger Games simulation being run in this server! Wait for it to end, then try again.');
                } else {
                    games[message.guild.id].started = true;
                    message.channel.fetchMessage(games[message.guild.id].reactionMessage).then((message) => {
                        let userList = [];
                        for (let reaction of message.reactions)
                            for (let user of reaction[1].users) {
                                let hasUser = false;

                                for (let i = 0; i < userList.length; i ++)
                                    if (userList[i].id === user[1].id)
                                        hasUser = true;

                                if (!hasUser)
                                    userList.push(user[1]);
                            }

                        playerList = [];
                        for (let i = 0; i < userList.length; i ++) {
                            let genders = db.get('genders').value();
                            playerList.push({
                                name: userList[i].username,
                                gender: genders[userList[i].id] || 'n',
                                district: Math.floor(i / 2) + 1,
                                inventory: [],
                                kills: 0,
                                status: 'healthy',
                                alive: true,
                                image: 'https://cdn.discordapp.com/avatars/' + userList[i].id + '/' + userList[i].avatar + '.png',
                                placement: 1
                            });
                        }
                        let bananaCount = 0;
                        for (let i = playerList.length; i < 24; i ++) {
                            playerList.push({
                                name: 'Banana ' + ++ bananaCount,
                                gender: 'n',
                                district: Math.floor(i / 2) + 1,
                                inventory: [],
                                kills: 0,
                                status: 'healthy',
                                alive: true,
                                image: 'https://i5.walmartimages.com/asr/209bb8a0-30ab-46be-b38d-58c2feb93e4a_1.1a15fb5bcbecbadd4a45822a11bf6257.jpeg',
                                placement: 1
                            });
                        }

                        games[message.guild.id].players = playerList;

                        runSimulation(message.channel, games[message.guild.id]);
                    });
                }
            } else {
                sendEmbedMsg(message.channel, 'React to this message to join! Once everybody reacts, type ' + config.prefix + 'start again to start the simulation, or ' + config.prefix + 'stop to cancel the simulation.').then((message2) => {
                    games[message.guild.id] = { players: [], host: message.author.id, reactionMessage: message2.id, day: 1, fallen: [], started: false, arenaHappened: false, feastHappened: false };
                });
            }
        } else if (command === 'stop') {
            delete games[message.guild.id];
            sendEmbedMsg(message.channel, 'Simulation has been stopped.');
        } else if (command === 'status') {
            if (games[message.guild.id] === undefined)
                sendEmbedMsg(message.channel, 'There is no simulation in progress');
            else
                sendPlayerList(message.channel, 'Status', games[message.guild.id].players);
        } else if (command === 'gender') {
            if (args.length !== 1) {
                sendEmbedMsg(message.channel, 'Usage: ' + config.prefix + 'gender <male/female>');
            } else {
                let genders = db.get('genders').value();
                if (args[0].toLowerCase() === 'male') genders[message.author.id] = 'm';
                else if (args[0].toLowerCase() === 'female') genders[message.author.id] = 'f';
                else if (args[0].toLowerCase() === 'none') genders[message.author.id] = 'n';
                else if (args[0].toLowerCase() === 'm') genders[message.author.id] = 'm';
                else if (args[0].toLowerCase() === 'f') genders[message.author.id] = 'f';
                else if (args[0].toLowerCase() === 'n') genders[message.author.id] = 'n';
                else {
                    sendEmbedMsg(message.channel, 'Usage: ' + config.prefix + 'gender <male/female/none>');
                    return;
                }
                sendEmbedMsg(message.channel, 'Set ' + message.author.username + '\'s gender to ' + args[0]);
                db.update('genders', genders).write();
            }
        }
	});

	client.login(config.token);
}
