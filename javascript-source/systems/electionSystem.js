
(function() {
    //test case for an election called during another election
    //likely create a reset function to wipe old systme and vals
    //user nominates themselves
    var NOMINATE_ARG = 'nominate', VOTE_ARG = 'vote', START_ARG = 'start', ELECTION_ARG = 'election', PRESIDENT_ARG = 'president', TEST_ARG = 'test'

    //The states that this module can be in.
    const states = {
        //Currently at rest
        NONE: 'none',
        //Currently in election state.  This is pre-nomination and effectively at rest as the bot is not accepting commands
        ELECTION: ELECTION_ARG,
        //In the nomination phase.  Users can run !election nominate <username> to help determine who gets on the ballot
        NOMINATE: NOMINATE_ARG,
        //In the voting phase.  Users can run !election vote <username> to determine who the next president will be
        VOTING: VOTE_ARG,
        //Someone has been elected and is in power at the moment.
        PRESIDENTIAL_TERM: PRESIDENT_ARG
    }

    // Whether or not the bot should be doing elections automatically
    var automatedElections = $.getSetIniDbBoolean('electionSettings', 'automatedelections', false),
            //how long to wait between automatic elections
            automatedElectionsDelay = $.getSetIniDbNumber('electionSettings', 'automatedelectionsdelay', 300),
            //How long between the start of an election and the nomination phase
            nominationDelay = $.getSetIniDbNumber('electionSettings', 'nominationdelay', 1),
            //How long the nomination phase lasts
            nominationLength = $.getSetIniDbNumber('electionSettings', 'nominationlength', 20),
            //How long the voting phase lasts
            votingLength = $.getSetIniDbNumber('electionSettings', 'votinglength', 20),
            //How many choices the on the ballot.  Must be greater than 1
            choiceCount = $.getSetIniDbNumber('electionSettings', 'choiceCount', 3) > 1 ? $.getSetIniDbNumber('electionSettings', 'choiceCount', 3) : 2,
            //How long the user becomes president for
            presidentLength = $.getSetIniDbNumber('electionSettings', 'presidentlenght', 10),
            //How high the chance is that there is a coup and the second most voted person takes office
            coupChance = $.getSetIniDbNumber('electionSettings', 'coupChance', 30),
            //The message indicating the start of an election
            electionStartMessage = $.getSetIniDbString('electionSettings', 'electionstartmessage', 'An election in ' + nominationDelay + ' seconds!  !election ' + NOMINATE_ARG + ' the person who you think should become the next king of chat.'),
            //The message indicating the nomination phase beginning
            nominationPhaseMessage = $.getSetIniDbString('electionSettings', 'nominationphasemessage', 'Nomination phase has begun!  It will end in ' + nominationLength + ' seconds.'),
            //The message indicating the beginning of a voting phase
            votePhaseMessage = $.getSetIniDbString('electionSettings', 'votephasemessage', ' have been selected for the ballot.  Use !election ' + VOTE_ARG + ' to vote for the person you would like to see win.'),
            //The message for a win (without coup)
            normalWinPhaseMessage = $.getSetIniDbString('electionSettings', 'normalwinphasemessage', ' has won the election and will be president for the next: ' + presidentLength + ' seconds.'),
            //The message for a win (With coup)
            coupWinPhaseMessage = $.getSetIniDbString('electionSettings', 'coupwinphasemessage', ' has won the election.  Unfortunately there was a coup and they were overthrown.  The next president is: '),
            //The message for no winner (not one elected or voted for)
            noWinPhaseMessage = $.getSetIniDbString('electionSettings', 'nowinphasemessage', 'Due to a low turnout, no one will be elected this term.  Enjoy your anarchy.'),
            //the time when the last election happened
            lastElection = 0,
            //The current state of the election
            state = states.NONE,
            //The interval to run automated elections at
            interval,
            //The container for the timeout used to transition states
            timeout,
            //The map of candidates and their votes.  {username -> vote}
            candidates = {},
            //A set used to determine if a user has already voted or nominated
            voteRecorder = {},
            //Who gets onto the ballot
            winners = {},
            //The username of the winner.  Used to validate commands from them
            president,
            //the number of tests that failed
            testFailures = 0,
            shouldTalk = true

    function say(message){
        if(shouldTalk){
            $.say(message)
        }
        else{
            $.consoleLn(message)

        }
    }
    /**
    * Usage command whispered when the user does not use the correct syntax
    */
    function whisperElectionUsage(sender){
        whisper(sender, 'Usage: !election nominate/vote <username> -- start (for administrators only)')
    }

    /**
    * Whisper a command to a user
    */
    function whisper(sender, message){
        say($.whisperPrefix(sender) + message);
    }

    /**
    * Validate the voting args from a user
    */
    function validateElectionArgs(args, sender){
        if (args[0] === undefined) {
            whisperElectionUsage(sender)
            return false;
        }
        else if((!args[0].equalsIgnoreCase(START_ARG) && !args[0].equalsIgnoreCase(TEST_ARG)) && args[1] === undefined){
            whisperElectionUsage(sender)
            return false
        }
        return true
    }

    /**
    * start the automatic timer to kick off automated elections
    */
    function startElectionTimer() {
        lastElection = $.systemTime();

        interval = setInterval(function() {
            if (commercialTimer && $.bot.isModuleEnabled('./systems/electionSystem.js')) {
                if ((lastElection + (automatedElectionsDelay * 1e3)) <= $.systemTime()) {
                    if ($.isOnline($.channelName)) {
                        startElection()
                    }
                }
            }
        }, 1e4, 'scripts::systems::electionSystem.js');
    };

    /**
    * Reset the system.  Clear all variables back to initialization
    */
    function reset(){
        if(state.equals(states.PRESIDENTIAL_TERM)){
            say("President ending")
        }
        else if(!state.equals(states.NONE)){
            say("Elections have been cut short...")
        }
        state = states.NONE
        candidates = {}
        clearTimeout(timeout)
        clearInterval(interval)
        voteRecorder = {}
        winners = {}
        president = undefined
    }

    /**
    * Begin an election and set a timer to being nomination phase`
    */
    function startElection(){
        reset()
        $.log.event("Beginning a new election at " + $.systemTime())
        say(electionStartMessage)
        state = states.ELECTION
        clearTimeout(timeout)
        timeout = setTimeout(function() {
            startNomination()
        }, nominationDelay * 1e3)
    }

    /**
    * Start the nomination phase
    */
    function startNomination() {
        $.log.event("Starting nomination phase: " + $.systemTime())
        say(nominationPhaseMessage)
        state = states.NOMINATE
        clearTimeout(timeout)
        timeout = setTimeout(function() {
            startVoting()
        }, nominationLength * 1e3)
    }

    /**
    * Start the voting phase
    */
    function startVoting() {
        $.log.event("Starting voting phase: " + $.systemTime())
        say(votePhaseMessage)
        state = states.VOTING
        //grab the top candidates from nomination and wipe previous voting data
        winners = getTopCandidates(candidates, choiceCount, false)
        voteRecorder = {}
        candidates = {}
        //break out if there were no nominations
        if(getKeys(winners).length == 0){
            say(noWinPhaseMessage)
            reset()
            return
        }
        $.consoleLn("Evaluated all candidates.  On the ballot is: " + getKeys(winners))
        clearTimeout(timeout)
        timeout = setTimeout(function() {
            startPresTerm()
        }, votingLength * 1e3)
    }

    /**
    * Start the presidential term.  Determine the winner, or determine if there was a coup
    */
    function startPresTerm(){
        $.log.event("Starting Presidential Term: " + $.systemTime())
        $.consoleLn("Starting Presidential Term: " + $.systemTime())
        state = states.PRESIDENTIAL_TERM
        var choices = getTopCandidates(candidates, 2, true)
        var shouldCoup = Math.random();
        coup = false
        say(choices)
        //break out due to no votes
        if(choices.length == 0){
            say(noWinPhaseMessage)
            reset()
            return
        }
        //Only one possible winner, or a coup is not possible (due to random), select first person
        else if(choices.length == 1 || shouldCoup >= coupChance){
            president = choices[0][0]
            say(normalWinPhaseMessage)
            say(president)
        }
        //more than one possible winner and a coup happened
        else{
            coup = true
            president = choices[1][0]
            say(coupWinPhaseMessage)
            say(president)
        }
        clearTimeout(timeout)
        //disable presidency in x time
        timeout = setTimeout(function() {
            reset()
        }, presidentLength * 1e3)
    }

    /**
    * Return the top candidates as either an n size ordered list or as an n size map constructed as {val -> frequency}
    */
    function getTopCandidates(candidates, n, asList) {
        sortable = []

        //JS makes us build a list to sort rather than sorting map directly
        for(var key in candidates) {
            sortable.push([key, candidates[key]]);
        }

        //sort the whole list here.
        //This could be done in n time but implementation is confusing and hard to read.
        sortable.sort(function(a, b) {
            return b[1] - a[1];
        });

        //return as a sorted list rather than a map with votes
        if(asList){
            return sortable.slice(0, n)
        }
        //return as object for constant time lookup rather than n time in list
        var objSorted = {}
        sortable.slice(0, n).forEach(function(item){
            objSorted[item[0]]=item[1]
        })
        return objSorted

    }

    /**
    * get the keys from a js object.  obj.keys() doesn't work in this context for some reason
    */
    function getKeys(obj){
        k = []
        for(key in obj){
            k.push(key)
        }
        return k
    }

    /**
    * Nominate a user.  Strips the leading @ from the name and makes it lowercase. A user cannot nominate twice
    * A user cannot nominate themselves
    */
    function nominate(sender, args) {
        if(states.NOMINATE.equalsIgnoreCase(state)){
            if(args[1].startsWith('@')){
                args[1] = args[1].replace('@', '')
            }
            args[1] = args[1].toLowerCase()
            sender = sender.toLowerCase()
            //disallow nominations for self.  Voting will be allowed for self.
            if(args[1].equalsIgnoreCase(sender)){
                whisper(sender, "Don't nominate yourself.")
                return
            }
            if(!voteRecorder[sender]){
                if(candidates[args[1]] === undefined){
                    candidates[args[1]] = 0
                }
                candidates[args[1]] = candidates[args[1]] + 1
                voteRecorder[sender] = true
            }
            else{
                whisper(sender, "You've already nominated someone")
            }
        }
        else{
            whisper(sender, "Not in nomination phase.  Screw off.")
        }
    }

    /**
    * Vote for a user.  Strips the leading @ from the name and makes it lowercase.  A user cannot vote twice
    * A user is allowed to vote for themselves
    */
    function vote(sender, args) {
        if(states.VOTING.equalsIgnoreCase(state)){
            if(args[1].startsWith('@')){
                args[1] = args[1].replace('@', '')
            }
            args[1] = args[1].toLowerCase()
            sender = sender.toLowerCase()
            if(candidates[args[1]] === undefined){
                candidates[args[1]] = 0
            }
            if(!voteRecorder[sender]){
                if(winners[args[1]] !== undefined){
                    if(candidates[args[1]] === undefined){
                        candidates[args[1]] = 0
                    }
                    candidates[args[1]] = candidates[args[1]] + 1
                    voteRecorder[sender] = true
                }
                else{
                    whisper(sender, "Sorry, " + args[1] + " is not on the ballot.");
                }
            }
            else{
                whisper(sender, "You've already voted")
            }
        }
        else{
            whisper(sender, "Not in voting phase.  Screw off.")
        }
    }

    function whisperPresidentUsage(sender){
        whisper(sender, "Usage: !president ban <username>")
    }

    function validatePresidentArgs(sender, args) {
        if(!sender.equalsIgnoreCase(president)){
            return false
        }
        if(args[0] === undefined) {
            whisperPresidentUsage(sender)
            return false
        }
        return true
    }

    /**
    * bind to args
    */
    $.bind('command', function(event) {
        var sender = event.getSender(),
            command = event.getCommand(),
            args = event.getArgs(),
            action = args[0],
            game = ($.getGame($.channelName) != '' ? $.getGame($.channelName) : 'Some Game');
        if(command.equalsIgnoreCase(ELECTION_ARG)){
            if(validateElectionArgs(args, sender)){
                //simple validation of arguments has confirmed that they aren't impossible
                if(action.equalsIgnoreCase(START_ARG)){
                    startElection(args)
                }
                else if(action.equalsIgnoreCase(NOMINATE_ARG)){
                    nominate(sender, args)
                }
                else if(action.equalsIgnoreCase(VOTE_ARG)){
                    vote(sender, args)
                }
                else if(action.equalsIgnoreCase(TEST_ARG)){
                    test()
                }
            }
        }
        if(command.equalsIgnoreCase(PRESIDENT_ARG)){
            if(validatePresidentArgs(args, sender)){
                if(action.equalsIgnoreCase()){
                    startElection(args)
                }
            }
        }
    })

    $.bind('initReady', function() {
        $.registerChatCommand('./systems/electionSystem.js', ELECTION_ARG, 7);
        $.registerChatSubcommand(ELECTION_ARG, NOMINATE_ARG, 7);
        $.registerChatSubcommand(ELECTION_ARG, VOTE_ARG, 7);
        $.registerChatSubcommand(ELECTION_ARG, START_ARG, 1);
        $.registerChatSubcommand(ELECTION_ARG, TEST_ARG, 0);
        $.registerChatCommand('./systems/electionSystem.js', PRESIDENT_ARG, 7);
    })


    /**
    * Test that a candidate who has not been voted for is recorded
    */
    var testNominateNominatesNewCandidate = function (){
        try{
            startElection()
            startNomination()
            var vote = "testNominee"
            nominate("testSender", ["nominate", vote])
            if(candidates[vote.toLowerCase()] != 1){
                say("testNominateNominatesNewCandidate failed.  Expected candidate to have 1 vote, had: " + candidates[vote.toLowerCase()])
                testFailures = testFailures + 1
            }
            else{
                say("testNominateNominatesNewCandidate passed")
            }
        } catch(err){
            testFailures++
            say(err)
        }
    }


    /**
    * Test that nominations are recorded correctly
    */
    var testNominateAddsToNomination = function (){
        try{
            startElection()
            startNomination()
            var vote = "testNominee"
            nominate("testSender", ["nominate", vote])
            nominate("testSender2", ["nominate", vote])
            if(candidates[vote.toLowerCase()] != 2){
                say("testNominateAddsToNomination failed.  Expected candidate to have 2 votes, had: " + candidates[vote.toLowerCase()])
                testFailures = testFailures + 1
            }
            else{
                say("testNominateAddsToNomination passed")
            }
        } catch(err){
            testFailures++
            say(err)
        }
    }

    /**
    * test that leading at signs are removed in nomination phase
    */
    var testNominateRemovesLeadingAtSign = function (){
        try{
            startElection()
            startNomination()
            var vote = "@testNominee"
            var actualVote = 'testnominee'
            nominate("testSender", ["nominate", vote])
            if(candidates[actualVote] != 1){
                say("testNominateRemovesLeadingAtSign failed.  Expected candidate to have 1 vote, had: " + candidates[actualVote])
                testFailures++
            }
            else{
                say("testNominateRemovesLeadingAtSign passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that the vote recording works correctly
    */
    var testUserIsUnableToNominateTwice = function (){
        try{
            startElection()
            startNomination()
            var vote = "testNominee"
            nominate("testSender", ["nominate", vote])
            //same name with different capitalization
            nominate("TestSender", ["nominate", vote])
            if(candidates[vote.toLowerCase()] != 1){
                say("testUserIsUnableToNominateTwice failed.  Expected candidate to have 1 vote, had: " + candidates[vote.toLowerCase()])
                testFailures++
            }
            else{
                say("testUserIsUnableToNominateTwice passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that users are unable to nominate themselves
    */
    var testUserIsUnableToNominateThemselves = function (){
        try{
            startElection()
            startNomination()
            var vote = "testNominee"
            nominate("testSender", ["nominate", vote])
            nominate(vote, ["nominate", vote])
            if(candidates[vote.toLowerCase()] != 1){
                say("testUserIsUnableToNominateThemselves failed.  Expected candidate to have 1 vote, had: " + candidates[vote.toLowerCase()])
                testFailures++
            }
            else{
                say("testUserIsUnableToNominateThemselves passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that election is aborted with no nominations
    */
    var testNoNominationsResultsInNoElection = function (){
        try{
            startElection()
            startNomination()
            startVoting()
            if(state != states.NONE){
                say("testNoNominationsResultsInNoElection failed.  Expected state to be none, not " + state)
                testFailures++
            }
            else{
                say("testNoNominationsResultsInNoElection passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that a user is able to vote for themselves
    */
    var testUserIsAbleToVoteForThemselves = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0]
            startVoting()
            vote(vote1, ['vote', vote1])
            if(candidates[vote1.toLowerCase()] != 1){
                say("testUserIsAbleToVoteForThemselves failed.  Expected candidate to have 1 vote, had: " + candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                say("testUserIsAbleToVoteForThemselves passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that a user is unable to vote multiple times
    */
    var testUserIsUnableToVoteTwice = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0]
            startVoting()
            vote("testSender", ['vote', vote1])
            vote("testSender", ['vote', vote1])
            if(candidates[vote1.toLowerCase()] != 1){
                say("testUserIsUnableToVoteTwice failed.  Expected candidate to have 1 vote, had: " + candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                say("testUserIsUnableToVoteTwice passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * test that the @ symbol is removed for voting
    */
    var testAtSignIsRemovedFromVote = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0]
            startVoting()
            vote("testSender", ['vote', '@' + vote1])
            if(candidates[vote1.toLowerCase()] != 1){
                say("testAtSignIsRemovedFromVote failed.  Expected candidate to have 1 vote, had: " + candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                say("testAtSignIsRemovedFromVote passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that voting is processed case insensitive to prevent grossness
    */
    var testVotingIsCaseInsensitive = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0]
            startVoting()
            vote("testSender", ['vote', vote1.toUpperCase()])
            if(candidates[vote1.toLowerCase()] != 1){
                say("testVotingIsCaseInsensitive failed.  Expected candidate to have 1 vote, had: " + candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                say("testVotingIsCaseInsensitive passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that users can only vote for people who have made it onto the ballot
    */
    var testUsersCanOnlyVoteForPeopleOnTheBallot = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0] + '1'
            startVoting()
            vote("testSender", ['vote', vote1])
            if(candidates[vote1.toLowerCase()]){
                say("testUsersCanOnlyVoteForPeopleOnTheBallot failed.  Expected candidate to have 1 vote, had: " + candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                say("testUsersCanOnlyVoteForPeopleOnTheBallot passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that the president is voted in correctly
    */
    var testPresidentIsElectedCorrectly = function (){
        try{
            votes = setUpVotes()
            vote1 = votes[0]
            startPresTerm()
            if(!president.equalsIgnoreCase(vote1)){
                say("testPresidentIsElectedCorrectly failed.  Expected candidate to have 1 vote, had: " + candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                say("testPresidentIsElectedCorrectly passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that voting is kicked out if no one votes.
    */
    var testNoVotesResultsInNoPresident = function (){
        try{
            votes = setUpNominations()
            startVoting()
            startPresTerm()
            if(state != states.NONE){
                say("testNoVotesResultsInNoPresident failed.  Expected state to be none, not: " + state)
                testFailures++
            }
            else{
                say("testNoVotesResultsInNoPresident passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that the president can run president commands
    */
    var testPresCanRunPresCommand = function (){
        try{
            votes = setUpNominations()
            startVoting()
            startPresTerm()
            if(state != states.NONE){
                say("testNoVotesResultsInNoPresident failed.  Expected state to be none, not: " + state)
                testFailures++
            }
            else{
                say("testNoVotesResultsInNoPresident passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    /**
    * Test that others cannot run president commands
    */
    var testOthersCannotRunPresCommand = function (){
        try{
            votes = setUpNominations()
            startVoting()
            startPresTerm()
            if(state != states.NONE){
                say("testNoVotesResultsInNoPresident failed.  Expected state to be none, not: " + state)
                testFailures++
            }
            else{
                say("testNoVotesResultsInNoPresident passed")
            }
        } catch(err) {
            testFailures++
            say(err)
        }
    }

    function test(){
        testRegistry = [
                    testNominateNominatesNewCandidate,
                    testNominateAddsToNomination,
                    testNominateRemovesLeadingAtSign,
                    testNoNominationsResultsInNoElection,
                    testUserIsUnableToNominateTwice,
                    testUserIsUnableToNominateThemselves,
                    testUserIsAbleToVoteForThemselves,
                    testUserIsUnableToVoteTwice,
                    testAtSignIsRemovedFromVote,
                    testVotingIsCaseInsensitive,
                    testUsersCanOnlyVoteForPeopleOnTheBallot,
                    testPresidentIsElectedCorrectly,
                    testNoVotesResultsInNoPresident,
                    testPresCanRunPresCommand,
                    testOthersCannotRunPresCommand
        ]
        testFailures = 0
        shouldTalk = false
        for(var i = 0; i < testRegistry.length; i++){
            say("\n\n\n")
            reset()
            testRegistry[i]()
        }
        $.say("Tests complete.  " + testFailures + " failures.  Check the logs for more verbose output")
    }

    function setUpNominations() {
        startElection()
        startNomination()
        var vote1 = "testNominee"
        var vote2 = "testNominee2"
        nominate("testSender", ["nominate", vote1])
        nominate("testSender2", ["nominate", vote1])
        nominate("testSender3", ["nominate", vote1])
        nominate("testSender4", ["nominate", vote1])
        nominate("testSender5", ["nominate", vote1])
        nominate("testSender6", ["nominate", vote1])
        nominate("testSender7", ["nominate", vote2])
        nominate("testSender8", ["nominate", vote2])
        nominate("testSender9", ["nominate", vote2])
        nominate("testSender10", ["nominate", vote2])
        nominate("testSender11", ["nominate", vote2])
        nominate("testSender12", ["nominate", vote2])
        nominate("testSender13", ["nominate", vote2])
        return [vote1, vote2]
    }

    function setUpVotes() {
        var votes = setUpNominations()
        vote1 = votes[0]
        startVoting()
        vote("testSender1", ['vote', vote1])
        vote("testSender2", ['vote', vote1])
        vote("testSender3", ['vote', vote1])
        vote("testSender4", ['vote', vote1])
        vote("testSender5", ['vote', vote1])
        vote("testSender6", ['vote', vote1])
        vote("testSender7", ['vote', vote1])
        vote("testSender8", ['vote', vote1])
        vote("testSender9", ['vote', vote1])
        vote("testSender10", ['vote', vote1])
        vote("testSender11", ['vote', vote1])
        vote("testSender12", ['vote', vote1])
        vote("testSender13", ['vote', vote1])
        vote("testSender14", ['vote', vote1])
        return votes
    }
})();