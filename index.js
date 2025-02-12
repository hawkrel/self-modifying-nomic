import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';
import { vm } from 'vm';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
});

const guildId = `1330851318239068260`;
const botId = `1333355481921617930`; // Your bot's user ID
const players = [
    { name: `AgentSmith`, discriminator: `6593`, channel: `smith`, id: `1330891055985594398` },
    { name: `AgentBrown`, discriminator: `1683`, channel: `brown`, id: `1330889555573735475` },
    { name: `AgentJones`, discriminator: `3574`, channel: `jones`, id: `1330892002694266880` },
];
// const gameMaster = { name: `NomicGameMaster`, discriminator: `3219`, channel: `gm`, id: `1330862485062025316` };
const agents = players; //[gameMaster, ...players];

const sandbox = {
    players: players.map((player) => ({ 
        ...player, 
        points: 0 
    })),
    activeProposerIndex: Math.floor(Math.random() * players.length),
    activeVoterIndex: 0,
    gainedPointsForRejectingAcceptedProposals: 10,
    lostPointsForGettingProposalRejected: 10,
    requiredPointsToWin: 200,
    proposal: null, // The current proposal
    votes: new Map(), // Votes on the current proposal
    receiveMessage: (author, content) => {
        // PROPOSE phase: Handle proposal submission
        if (proposal === null) {
            return receiveProposal(author, content);
        
        // VOTE phase: Handle voting
        } else {
            return receiveVote(author, content);
        } 
    },
    requestProposal: () => {
        const activeProposer = players[activeProposerIndex];
        return [{
            channel: activeProposer.channel,
            content: `Propose an executable update to the game, <@${activeProposer.id}>`
        }]
    },
    receiveProposal: (author, content) => {
        if (author !== players[activeProposerIndex].channel) {
            throw new Error(`It's not your turn to propose.`);
        }
        if (proposal) {
            throw new Error(`There is already a proposal in progress.`);
        }
        proposal = content;
        votes = new Map([activePlayer.name, "APPROVE" ]); // Proposer auto-approves
        activeVoterIndex = (activeVoterIndex + 1) % players.length;
        return votingPhase();
    },
    votingPhase: () => {
        if (activeVoterIndex === activeProposerIndex) {
            return tallyVotes();
        } else {
            return requestVote();
        }
    },
    requestVote: () => {
        const activeVoter = players[activeVoterIndex];
        return [{
            channel: activeVoter.channel,
            content: `Vote on the proposal with "APPROVE" or "REJECT": "${proposal}", <@${activeProposer.id}>`
        }]
    },
    receiveVote: (author, content) => {
        if (author !== players[activeVoterIndex].channel) {
            throw new Error(`It's not your turn to vote.`);
        }
        if (!proposal) {
            throw new Error(`There is no proposal to vote on.`);
        }
        if (votes.has(author)) {
            throw new Error(`You have already voted.`);
        }
        const approves = content.includes("APPROVE");
        const rejects = content.includes("REJECT");
        if (!approves && !rejects) {
            throw new Error(`Invalid vote: ${content}. Please vote "APPROVE" or "REJECT".`);
        } else if (approves && rejects) {
            throw new Error(`Invalid vote: ${content}. Please only vote "APPROVE" or "REJECT".`);
        } else if (approves) {
            votes.set(author, "APPROVE");
        } else {
            votes.set(author, "REJECT");
        }
        activeVoterIndex = (activeVoterIndex + 1) % players.length;
        return votingPhase();
    },
    tallyVotes: () => {
        let approveCount = 0;
        let rejectCount = 0;
        for (const vote of votes.values()) {
            if (vote === "APPROVE") {
                approveCount++;
            } else {
                rejectCount++;
            }
        }
        if (approveCount > rejectCount) {
            return proposalAccepted();
        } else {
            return proposalRejected();
        }
    },
    gainPointsForRejectors: () => {
        const rejectors = players.filter((player) => votes.get(player.name) === "REJECT");
        rejectors.forEach((rejector) => {
            gainPoints(players.findIndex((player) => player.channel === rejector.channel), gainedPointsForRejectingAcceptedProposals);
        });
        const rejectorsString = rejectors.map(r => `${r.name}`).join(", ");
        return players.map((player) => ({
            channel: player.channel,
            content: `Players ${rejectorsString} gained ${gainedPointsForRejectingAcceptedProposals} points each for rejecting the overall accepted proposal.`
        }));
    },
    proposalAccepted: () => {
        const messages = gainPointsForRejectors();
        try {
            vm.runInContext(proposal, sandbox);
            messages.push(...proposalApplied());
        } catch (error) {
            messages.push(...proposalFailed(error));
        }
        return messages;
    },
    proposalApplied: () => {
        return [
            ...players.map((player) => ({
                channel: player.channel,
                content: `Proposal approved: "${proposal}" has been successfully applied.`
            })),
            ...nextProposalPhase()
        ];
    },
    proposalFailed: (error) => {
        return [
            ...players.map((player) => ({
                channel: player.channel,
                content: `Proposal approved but failed: "${proposal}" has resulted in Error "${error.message}".`
            })),
            ...nextProposalPhase()
        ];
    },
    proposalRejected: () => {
        return [
            ...players.map((player) => ({
                channel: player.channel,
                content: `Proposal rejected: "${proposal}" has not been applied.`
            })),
            ...losePointsForRejectedProposer(),
            ...nextProposalPhase()
        ];
    },
    losePointsForRejectedProposer: () => {
        losePoints(activeProposerIndex, lostPointsForGettingProposalRejected);
        return players.map((player) => ({
            channel: player.channel,
            content: `Player ${players[activeProposerIndex].name} lost ${lostPointsForGettingProposalRejected} points for having their proposal rejected.`
        }));
    },
    gainDieRollPointsForActiveProposer: () => {
        const dieRoll = Math.ceil(Math.random() * 6);
        gainPoints(activeProposerIndex, dieRoll);
        return players.map((player) => ({
            channel: player.channel,
            content: `Player ${player.name} gained ${dieRoll} points due to the die roll at the end of their proposal phase.`
        }))
    },
    nextProposalPhase: () => {
        const messages = gainDieRollPointsForActiveProposer();
        proposal = null;
        votes = new Map();
        activeProposerIndex = (activeProposerIndex + 1) % players.length;
        return [
            ...messages,
            ...requestProposal()
        ];
    },
    losePoints(playerIndex, pointsAmount) {
        players[playerIndex].points -= pointsAmount;
    },
    gainPoints(playerIndex, pointsAmount) {
        players[playerIndex].points += pointsAmount;
        checkWinCondition(playerIndex);
    },
    checkWinCondition(playerIndex) {
        if (players[playerIndex].points >= requiredPointsToWin) {
            // TODO
        }
    }
};
  
vm.createContext(sandbox);
  

async function createPrivateChannel(guildId, channelName, userId) {
    console.log(`Creating private channel: ${channelName} for user: ${userId}`);
    // try {
      // Fetch the guild
    const guild = await client.guilds.fetch(guildId);

    if (!guild) {
    console.log(`Guild not found.`);
    return null;
    }

    const member = await guild.members.fetch(userId); // Fetch the user in the guild
    if (!member) {
        console.log('User is not a member of the guild.');
        return;
    }

    // Check if the channel already exists
    const existingChannel = guild.channels.cache.find((channel) => channel.name === channelName);
    if (existingChannel) {
        console.log(`Channel already exists: ${existingChannel.name}. Deleting it.`);
        await existingChannel.delete();
        // return;
    }
  
    // Create the private channel
    const channel = await guild.channels.create({
    name: channelName,
    type: 0, // `0` for text channels, `2` for voice channels
    permissionOverwrites: [
        {
            id: guild.roles.everyone.id, // Deny access for everyone
            deny: [`ViewChannel`, `SendMessages`],
        },
        {
            id: userId, // Allow access for specific users
            allow: [`ViewChannel`, `SendMessages`],
        },
        {
            id: botId, // Allow access for this bot
            allow: [`ViewChannel`, `SendMessages`],
        },
    ],
    });
  
    console.log(`Channel created: ${channel.name}`);
    return channel;
    // } catch (error) {
    //   throw new Error(`Error creating private channel:`, error);
    //   return null;
    // }
};

client.once(`ready`, () => {
    console.log(`Logged in as ${client.user.tag}!`);
    startGame();
});

async function startGame() {
    for (const user of players) {
        const channel = await createPrivateChannel(guildId, user.channel, user.id);
        if (channel) {
            console.log(`Channel created for ${user.name}: ${channel.name}`);
        } else {
            throw new Error(`Failed to create channel for ${user.name}`);
        }
    }
    await runAndSend(`requestProposal();`);
}

async function sendLongMessage(channel, content, wrapperStart = ``, wrapperEnd = ``) {
    const lines = content.split(`\n`);
    let chunk = wrapperStart;
  
    for (const line of lines) {
        if (chunk.length + line.length + wrapperEnd.length + 1 > 2000) { // +1 for the newline character
            chunk += wrapperEnd;
            await channel.send(chunk);
            chunk = wrapperStart;
        }
        chunk += `${line}\n`;
    }
  
    if (chunk.length > wrapperStart.length) {
        chunk += wrapperEnd;
        await channel.send(chunk);
    }
};

function getStateString() {
    // Convert the sandbox to a string
    return util.inspect(sandbox, {
        depth: null, // Allows deep inspection
        showHidden: false, // Shows non-enumerable properties if true
        compact: false, // Makes it more readable
    });
}

const explainer = `
    You are a participant in a Nomic game. Your reply will be evaluated as JavaScript code above, in the function "receiveMessage" (first argument is your name, the second one is your message). Please reply accordingly.
`;
async function runAndSend(code) {
    const stateString = getStateString();
    try {
        const replies = vm.runInContext(code, sandbox);
        for (const reply of replies) {
            const channel = message.guild.channels.cache.find((channel) => channel.name === reply.channel);
            if (channel) {
                await sendLongMessage(channel, `Current game state:`);
                await sendLongMessage(channel, stateString, `\`\`\`js\n`, `\`\`\``);
                await sendLongMessage(channel, explainer);
                await sendLongMessage(channel, reply.content);
            }
        }
    } catch(error) {
        await sendLongMessage(channel, `Current game state:`);
        await sendLongMessage(channel, stateString, `\`\`\`js\n`, `\`\`\``);
        await sendLongMessage(channel, explainer);
        await sendLongMessage(
            channel,
            `your message "${code}" caused the following error: ${error.message}. Please correct it and try again.`
        );
    }
};

client.on(`messageCreate`, async (message) => {
    const agent = agents.find((agent) => message.channel.name === agent.channel);
    if (!agent) {
        return;
    }
    if (message.author.id !== agent.id) {
        return;
    }
    await runAndSend(`receiveMessage("${agent.channel}", "${message.content}");`);
});

client.login(process.env.TOKEN);
