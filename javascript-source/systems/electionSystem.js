/**
 * TODO: 
 * ability to reset election for mods
 * ability to give presidency to a person
 */ 
(function() {
    //The states that this module can be in.
    var states = {
        //Currently at rest
        NONE: 'none',
        //Currently in election state.  This is pre-nomination and effectively at rest as the bot is not accepting commands
        ELECTION: 'election',
        //In the nomination phase.  Users can run !election nominate <username> to help determine who gets on the ballot
        NOMINATE: 'nominate',
        //In the voting phase.  Users can run !election vote <username> to determine who the next president will be
        VOTING: 'vote',
        //Someone has been elected and is in power at the moment.
        PRESIDENTIAL_TERM: 'president'
    }

    var electionSystem = {
        //test case for an election called during another election
        //likely create a reset function to wipe old systme and vals
        //user nominates themselves
        NOMINATE_ARG: 'nominate',
        VOTE_ARG: 'vote',
        START_ARG: 'start',
        ELECTION_ARG: 'election',
        PRESIDENT_ARG: 'president',
        TEST_ARG: 'test',

        // Whether or not the bot should be doing elections automatically
        automatedElections: $.getSetIniDbBoolean('electionSettings', 'automatedelections', false),
        //how long to wait between automatic elections
        automatedElectionsDelay: $.getSetIniDbNumber('electionSettings', 'automatedelectionsdelay', 300),
        //How long between the start of an election and the nomination phase
        nominationDelay: $.getSetIniDbNumber('electionSettings', 'nominationdelay', 1),
        //How long the nomination phase lasts
        nominationLength: $.getSetIniDbNumber('electionSettings', 'nominationlength', 20),
        //How long the voting phase lasts
        votingLength: $.getSetIniDbNumber('electionSettings', 'votinglength', 20),
        //How many choices the on the ballot.  Must be greater than 1
        choiceCount: $.getSetIniDbNumber('electionSettings', 'choiceCount', 3) > 1 ? $.getSetIniDbNumber('electionSettings', 'choiceCount', 3) : 2,
        //How long the user becomes president for
        presidentLength: $.getSetIniDbNumber('electionSettings', 'presidentlenght', 10),
        //How high the chance is that there is a coup and the second most voted person takes office
        coupChance: $.getSetIniDbNumber('electionSettings', 'coupChance', 30),
        //The message indicating the start of an election
        electionStartMessage: $.getSetIniDbString('electionSettings', 'electionstartmessage', 'An election in ' + this.nominationDelay + ' seconds!  !election ' + this.NOMINATE_ARG + ' the person who you think should become the next king of chat.'),
        //The message indicating the nomination phase beginning
        nominationPhaseMessage: $.getSetIniDbString('electionSettings', 'nominationphasemessage', 'Nomination phase has begun!  It will end in ' + this.nominationLength + ' seconds.'),
        //The message indicating the beginning of a voting phase
        votePhaseMessage: $.getSetIniDbString('electionSettings', 'votephasemessage', ' have been selected for the ballot.  Use !election ' + this.VOTE_ARG + ' to vote for the person you would like to see win.'),
        //The message for a win (without coup)
        normalWinPhaseMessage: $.getSetIniDbString('electionSettings', 'normalwinphasemessage', ' has won the election and will be president for the next: ' + this.presidentLength + ' seconds.'),
        //The message for a win (With coup)
        coupWinPhaseMessage: $.getSetIniDbString('electionSettings', 'coupwinphasemessage', ' has won the election.  Unfortunately there was a coup and they were overthrown.  The next president is: '),
        //The message for no winner (not one elected or voted for)
        noWinPhaseMessage: $.getSetIniDbString('electionSettings', 'nowinphasemessage', 'Due to a low turnout, no one will be elected this term.  Enjoy your anarchy.'),
        //the time when the last election happened
        lastElection: 0,
        //The current state of the election
        state: states.NONE,
        //The interval to run automated elections at
        interval: undefined,
        //The container for the timeout used to transition states
        timeout: undefined,
        //The map of candidates and their votes.  {username -> vote}
        candidates: {},
        //A set used to determine if a user has already voted or nominated
        voteRecorder: {},
        //Who gets onto the ballot
        winners: {},
        //The username of the winner.  Used to validate commands from them
        president: undefined,
        //the number of tests that failed
        testFailures: 0,
        shouldTalk: true,
        subscribers: [],
        possibleStates: states,

        /**
         * Write  message to the specified place
         */
        say: function(message){
            if(this.shouldTalk){
                $.say(message)
            }
            else{
                $.consoleLn(message)
            }
        },

        /**
        * Usage command whispered when the user does not use the correct syntax
        */
        whisperUsage: function(sender){
            this.whisper(sender, 'Usage: !election nominate/vote <username> -- start (for administrators only)')
        },

        /**
        * Whisper a command to a user
        */
        whisper: function(sender, message){
            this.say($.whisperPrefix(sender) + message);
        },

        /**
        * Validate the voting args from a user
        */
        validateArgs: function(args, sender){
            if (args[0] === undefined) {
                this.whisperElectionUsage(sender)
                return false;
            }
            else if((!args[0].equalsIgnoreCase(this.START_ARG) && !args[0].equalsIgnoreCase(this.TEST_ARG)) && args[1] === undefined){
                this.whisperElectionUsage(sender)
                return false
            }
            return true
        },

        /**
        * start the automatic timer to kick off automated elections
        */
        startElectionTimer: function() {
            lastElection = $.systemTime();

            interval = setInterval(function() {
                if (commercialTimer && $.bot.isModuleEnabled('./systems/electionSystem.js')) {
                    if ((this.lastElection + (this.automatedElectionsDelay * 1e3)) <= $.systemTime()) {
                        if ($.isOnline($.channelName)) {
                            this.startElection()
                        }
                    }
                }
            }, 1e4, 'scripts::systems::electionSystem.js');
        },

        /**
        * Reset the system.  Clear all variables back to initialization
        */
        reset: function(){
            if(this.possibleStates.PRESIDENTIAL_TERM.equals(this.state)){
                this.say("President ending")
            }
            else if(!this.possibleStates.NONE.equals(this.state)){
                this.say("Elections have been cut short...")
            }
            this.state = this.possibleStates.NONE
            this.candidates = {}
            clearTimeout(this.timeout)
            clearInterval(this.interval)
            this.voteRecorder = {}
            this.winners = {}
            var oldPres = this.president
            this.president = undefined
            this.notifySubscribers(this.state, {'oldPresident': oldPres})
        },

        /**
        * Begin an election and set a timer to being nomination phase`
        */
        startElection: function(){
            this.reset()
            $.log.event("Beginning a new election at " + $.systemTime())
            this.say(this.electionStartMessage)
            this.state = this.possibleStates.ELECTION
            this.notifySubscribers(this.state, {})
            clearTimeout(this.timeout)
            this.timeout = setTimeout(function() {
                this.startNomination()
            }, this.nominationDelay * 1e3)
        },

        /**
        * Start the nomination phase
        */
        startNomination: function() {
            $.log.event("Starting nomination phase: " + $.systemTime())
            this.say(this.nominationPhaseMessage)
            this.state = this.possibleStates.NOMINATE
            this.notifySubscribers(this.state, {})
            clearTimeout(this.timeout)
            this.timeout = setTimeout(function() {
                this.startVoting()
            }, this.nominationLength * 1e3)
        },

        /**
        * Start the voting phase
        */
        startVoting: function() {
            $.log.event("Starting voting phase: " + $.systemTime())
            this.say(this.votePhaseMessage)
            this.state = this.possibleStates.VOTING            
            //grab the top candidates from nomination and wipe previous voting data
            this.winners = this.getTopCandidates(this.candidates, this.choiceCount, false)
            this.voteRecorder = {}
            this.candidates = {}
            //break out if there were no nominations
            if(this.getKeys(this.winners).length == 0){
                this.say(this.noWinPhaseMessage)
                this.reset()
                return
            }
            this.notifySubscribers(this.state, {'nominees': this.winners})
            $.consoleLn("Evaluated all candidates.  On the ballot is: " + this.getKeys(this.winners))
            clearTimeout(this.timeout)
            this.timeout = setTimeout(function() {
                this.startPresTerm()
            }, this.votingLength * 1e3)
        },

        /**
        * Start the presidential term.  Determine the winner, or determine if there was a coup
        */
        startPresTerm: function(){
            $.log.event("Starting Presidential Term: " + $.systemTime())
            $.consoleLn("Starting Presidential Term: " + $.systemTime())
            this.state = this.possibleStates.PRESIDENTIAL_TERM
            var choices = this.getTopCandidates(this.candidates, 2, true)
            var shouldCoup = Math.random();
            coup = false
            this.say(choices)
            //break out due to no votes
            if(choices.length == 0){
                this.say(this.noWinPhaseMessage)
                this.reset()
                return
            }
            //Only one possible winner, or a coup is not possible (due to random), select first person
            else if(choices.length == 1 || shouldCoup >= coupChance){
                this.president = choices[0][0]
                this.say(this.normalWinPhaseMessage)
                this.say(this.president)
            }
            //more than one possible winner and a coup happened
            else{
                coup = true
                this.president = choices[1][0]
                this.say(this.coupWinPhaseMessage)
                this.say(this.president)
            }
            this.notifySubscribers(this.state, {'president': this.president, 'endTime': $.systemTime + (this.presidentLength * 1e3)})
            clearTimeout(this.timeout)
            //disable presidency in x time
            this.timeout = setTimeout(function() {
                this.reset()
            }, this.presidentLength * 1e3)
        },

        /**
        * Return the top candidates as either an n size ordered list or as an n size map constructed as {val -> frequency}
        */
        getTopCandidates: function(candidates, n, asList) {
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

        },

        /**
        * get the keys from a js object.  obj.keys() doesn't work in this context for some reason
        */
        getKeys: function(obj){
            k = []
            for(key in obj){
                k.push(key)
            }
            return k
        },

        /**
        * Nominate a user.  Strips the leading @ from the name and makes it lowercase. A user cannot nominate twice
        * A user cannot nominate themselves
        */
        nominate: function(sender, args) {
            if(this.possibleStates.NOMINATE.equalsIgnoreCase(this.state)){
                args[1] = $.user.sanitize(args[1])
                sender = $.user.sanitize(sender)
                //disallow nominations for self.  Voting will be allowed for self.
                if(args[1].equalsIgnoreCase(sender)){
                    this.whisper(sender, "Don't nominate yourself.")
                    return
                }
                if(!this.voteRecorder[sender]){
                    if(this.candidates[args[1]] === undefined){
                        this.candidates[args[1]] = 0
                    }
                    this.candidates[args[1]] = this.candidates[args[1]] + 1
                    this.voteRecorder[sender] = true
                }
                else{
                    this.whisper(sender, "You've already nominated someone")
                }
            }
            else{
                this.whisper(sender, "Not in nomination phase.  Screw off.")
            }
        },

        /**
        * Vote for a user.  Strips the leading @ from the name and makes it lowercase.  A user cannot vote twice
        * A user is allowed to vote for themselves
        */
        vote: function(sender, args) {
            if(this.possibleStates.VOTING.equalsIgnoreCase(this.state)){
                args[1] = $.user.sanitize(args[1])
                sender = $.user.sanitize(sender)
                if(this.candidates[args[1]] === undefined){
                    this.candidates[args[1]] = 0
                }
                if(!this.voteRecorder[sender]){
                    if(this.winners[args[1]] !== undefined){
                        if(this.candidates[args[1]] === undefined){
                            this.candidates[args[1]] = 0
                        }
                        this.candidates[args[1]] = this.candidates[args[1]] + 1
                        this.voteRecorder[sender] = true
                    }
                    else{
                        this.whisper(sender, "Sorry, " + args[1] + " is not on the ballot.");
                    }
                }
                else{
                    this.whisper(sender, "You've already voted")
                }
            }
            else{
                this.whisper(sender, "Not in voting phase.  Screw off.")
            }
        },

        subscribe: function(module){
            this.say("New subscriber: "+module)
            this.subscribers.push(module)
        },

        notifySubscribers(state, extra){
            this.say("Notifying subs of state change: "+ state)
            for(key in this.subscribers){
                sub = this.subscribers[key]
                if(sub.stateChange !== undefined){
                    try{
                        sub.stateChange(state, extra)
                    }
                    catch(e){
                        $.consoleLn(err)
                    }
                }
            }
        }
    }
    $.electionSystem = electionSystem

    /**
    * bind to args
    */
    $.bind('command', function(event) {
        var sender = event.getSender(),
            command = event.getCommand(),
            args = event.getArgs(),
            action = args[0]
        if(command.equalsIgnoreCase($.electionSystem.ELECTION_ARG)){
            if($.electionSystem.validateArgs(args, sender)){
                //simple validation of arguments has confirmed that they aren't impossible
                if(action.equalsIgnoreCase($.electionSystem.START_ARG)){
                    $.electionSystem.startElection(args)
                }
                else if(action.equalsIgnoreCase($.electionSystem.NOMINATE_ARG)){
                    $.electionSystem.nominate(sender, args)
                }
                else if(action.equalsIgnoreCase($.electionSystem.VOTE_ARG)){
                    $.electionSystem.vote(sender, args)
                }
                else if(action.equalsIgnoreCase($.electionSystem.TEST_ARG)){
                    test()
                }
            }
        }
    })

    $.bind('initReady', function() {
        $.registerChatCommand('./systems/electionSystem.js', electionSystem.ELECTION_ARG, 7);
        $.registerChatSubcommand(electionSystem.ELECTION_ARG, electionSystem.NOMINATE_ARG, 7);
        $.registerChatSubcommand(electionSystem.ELECTION_ARG, electionSystem.VOTE_ARG, 7);
        $.registerChatSubcommand(electionSystem.ELECTION_ARG, electionSystem.START_ARG, 1);
        $.registerChatSubcommand(electionSystem.ELECTION_ARG, electionSystem.TEST_ARG, 0);
    })

    var stateSpy = {
        state: undefined,
        args: undefined,
        stateChange: function(state, extra){
            this.state = state
            this.args = extra
        }
    }


    /**
    * Test that a candidate who has not been voted for is recorded
    */
    var testNominateNominatesNewCandidate = function (){
        try{
            $.electionSystem.startElection()
            $.electionSystem.startNomination()
            var vote = "testNominee"
            $.electionSystem.nominate("testSender", ["nominate", vote])
            if($.electionSystem.candidates[vote.toLowerCase()] != 1){
                $.electionSystem.say("testNominateNominatesNewCandidate failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote.toLowerCase()])
                testFailures = testFailures + 1
            }
            else{
                $.electionSystem.say("testNominateNominatesNewCandidate passed")
            }
        } catch(err){
            testFailures++
            $.electionSystem.say(err)
        }
    }


    /**
    * Test that nominations are recorded correctly
    */
    var testNominateAddsToNomination = function (){
        try{
            $.electionSystem.startElection()
            $.electionSystem.startNomination()
            var vote = "testNominee"
            $.electionSystem.nominate("testSender", ["nominate", vote])
            $.electionSystem.nominate("testSender2", ["nominate", vote])
            if($.electionSystem.candidates[vote.toLowerCase()] != 2){
                $.electionSystem.say("testNominateAddsToNomination failed.  Expected candidate to have 2 votes, had: " + $.electionSystem.candidates[vote.toLowerCase()])
                testFailures = testFailures + 1
            }
            else{
                $.electionSystem.say("testNominateAddsToNomination passed")
            }
        } catch(err){
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * test that leading at signs are removed in nomination phase
    */
    var testNominateRemovesLeadingAtSign = function (){
        try{
            $.electionSystem.startElection()
            $.electionSystem.startNomination()
            var vote = "@testNominee"
            var actualVote = 'testnominee'
            $.electionSystem.nominate("testSender", ["nominate", vote])
            if($.electionSystem.candidates[actualVote] != 1){
                $.electionSystem.say("testNominateRemovesLeadingAtSign failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[actualVote])
                testFailures++
            }
            else{
                $.electionSystem.say("testNominateRemovesLeadingAtSign passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that the vote recording works correctly
    */
    var testUserIsUnableToNominateTwice = function (){
        try{
            $.electionSystem.startElection()
            $.electionSystem.startNomination()
            var vote = "testNominee"
            $.electionSystem.nominate("testSender", ["nominate", vote])
            //same name with different capitalization
            $.electionSystem.nominate("TestSender", ["nominate", vote])
            if($.electionSystem.candidates[vote.toLowerCase()] != 1){
                $.electionSystem.say("testUserIsUnableToNominateTwice failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote.toLowerCase()])
                testFailures++
            }
            else{
                $.electionSystem.say("testUserIsUnableToNominateTwice passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that users are unable to nominate themselves
    */
    var testUserIsUnableToNominateThemselves = function (){
        try{
            $.electionSystem.startElection()
            $.electionSystem.startNomination()
            var vote = "testNominee"
            $.electionSystem.nominate("testSender", ["nominate", vote])
            $.electionSystem.nominate(vote, ["nominate", vote])
            if($.electionSystem.candidates[vote.toLowerCase()] != 1){
                $.electionSystem.say("testUserIsUnableToNominateThemselves failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote.toLowerCase()])
                testFailures++
            }
            else{
                $.electionSystem.say("testUserIsUnableToNominateThemselves passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that election is aborted with no nominations
    */
    var testNoNominationsResultsInNoElection = function (){
        try{
            $.electionSystem.startElection()
            $.electionSystem.startNomination()
            $.electionSystem.startVoting()
            if($.electionSystem.state != $.electionSystem.possibleStates.NONE){
                $.electionSystem.say("testNoNominationsResultsInNoElection failed.  Expected state to be none, not " + $.electionSystem.state)
                testFailures++
            }
            else{
                $.electionSystem.say("testNoNominationsResultsInNoElection passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that a user is able to vote for themselves
    */
    var testUserIsAbleToVoteForThemselves = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0]
            $.electionSystem.startVoting()
            $.electionSystem.vote(vote1, ['vote', vote1])
            if($.electionSystem.candidates[vote1.toLowerCase()] != 1){
                $.electionSystem.say("testUserIsAbleToVoteForThemselves failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                $.electionSystem.say("testUserIsAbleToVoteForThemselves passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that a user is unable to vote multiple times
    */
    var testUserIsUnableToVoteTwice = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0]
            $.electionSystem.startVoting()
            $.electionSystem.vote("testSender", ['vote', vote1])
            $.electionSystem.vote("testSender", ['vote', vote1])
            if($.electionSystem.candidates[vote1.toLowerCase()] != 1){
                $.electionSystem.say("testUserIsUnableToVoteTwice failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                $.electionSystem.say("testUserIsUnableToVoteTwice passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * test that the @ symbol is removed for voting
    */
    var testAtSignIsRemovedFromVote = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0]
            $.electionSystem.startVoting()
            $.electionSystem.vote("testSender", ['vote', '@' + vote1])
            if($.electionSystem.candidates[vote1.toLowerCase()] != 1){
                $.electionSystem.say("testAtSignIsRemovedFromVote failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                $.electionSystem.say("testAtSignIsRemovedFromVote passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that voting is processed case insensitive to prevent grossness
    */
    var testVotingIsCaseInsensitive = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0]
            $.electionSystem.startVoting()
            $.electionSystem.vote("testSender", ['vote', vote1.toUpperCase()])
            if($.electionSystem.candidates[vote1.toLowerCase()] != 1){
                $.electionSystem.say("testVotingIsCaseInsensitive failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                $.electionSystem.say("testVotingIsCaseInsensitive passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that users can only vote for people who have made it onto the ballot
    */
    var testUsersCanOnlyVoteForPeopleOnTheBallot = function (){
        try{
            var votes = setUpNominations()
            vote1 = votes[0] + '1'
            $.electionSystem.startVoting()
            $.electionSystem.vote("testSender", ['vote', vote1])
            if($.electionSystem.candidates[vote1.toLowerCase()]){
                $.electionSystem.say("testUsersCanOnlyVoteForPeopleOnTheBallot failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                $.electionSystem.say("testUsersCanOnlyVoteForPeopleOnTheBallot passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that the president is voted in correctly
    */
    var testPresidentIsElectedCorrectly = function (){
        try{
            votes = setUpVotes()
            vote1 = votes[0]
            $.electionSystem.startPresTerm()
            if(!$.electionSystem.president.equalsIgnoreCase(vote1)){
                $.electionSystem.say("testPresidentIsElectedCorrectly failed.  Expected candidate to have 1 vote, had: " + $.electionSystem.candidates[vote1.toLowerCase()])
                testFailures++
            }
            else{
                $.electionSystem.say("testPresidentIsElectedCorrectly passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that voting is kicked out if no one votes.
    */
    var testNoVotesResultsInNoPresident = function (){
        try{
            votes = setUpNominations()
            $.electionSystem.startVoting()
            $.electionSystem.startPresTerm()
            if($.electionSystem.state != $.electionSystem.possibleStates.NONE){
                $.electionSystem.say("testNoVotesResultsInNoPresident failed.  Expected state to be none, not: " + $.electionSystem.state)
                testFailures++
            }
            else{
                $.electionSystem.say("testNoVotesResultsInNoPresident passed")
            }
        } catch(err) {
            testFailures++
            $.electionSystem.say(err)
        }
    }

    /**
    * Test that subscribers are notified throughout process
    */
   var testSubscribersNotified = function (){
       $.electionSystem.subscribe
        try{
            $.electionSystem.startElection()
            if(stateSpy.state != $.electionSystem.possibleStates.ELECTION){
                $.electionSystem.say("testSubscribersNotified failed. Expected state spy to be notified of state change.  It was not.")
                testFailures++
                return
            }
            $.electionSystem.startNomination()
            if(stateSpy.state != $.electionSystem.possibleStates.NOMINATE){
                $.electionSystem.say("testSubscribersNotified failed. Expected state spy to be notified of state change.  It was not.")
                testFailures++
                return
            }
            $.electionSystem.nominate("testSender", ["nominate", "t"])
            $.electionSystem.startVoting()
            if(stateSpy.state != $.electionSystem.possibleStates.VOTING){
                $.electionSystem.say("testSubscribersNotified failed. Expected state spy to be notified of state change.  It was not.")
                testFailures++
                return
            }
            $.electionSystem.vote("testSender", ["vote", "t"])
            $.electionSystem.startPresTerm()
            if(stateSpy.state != $.electionSystem.possibleStates.PRESIDENTIAL_TERM){
                $.electionSystem.say("testSubscribersNotified failed. Expected state spy to be notified of state change.  It was not.")
                testFailures++
                return
            }
        } catch(err) {
            $.electionSystem.say(err)
            testFailures++
        }
    }

    function test(){
        try{
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
                        testSubscribersNotified
            ]
            testFailures = 0
            $.electionSystem.shouldTalk = false
            $.electionSystem.subscribe(stateSpy)
            for(var i = 0; i < testRegistry.length; i++){
                $.electionSystem.say("\n\n\n")
                $.electionSystem.reset()
                testRegistry[i]()
            }
            $.electionSystem.say("\n\n\n")
            $.say("Tests complete.  " + testFailures + " failures.  Check the logs for more verbose output")
        } catch(e){
            $.electionSystem.say("Fatal Test Error")
            $.electionSystem.say(e)
        }
    }

    function setUpNominations() {
        $.electionSystem.startElection()
        $.electionSystem.startNomination()
        var vote1 = "testNominee"
        var vote2 = "testNominee2"
        $.electionSystem.nominate("testSender", ["nominate", vote1])
        $.electionSystem.nominate("testSender2", ["nominate", vote1])
        $.electionSystem.nominate("testSender3", ["nominate", vote1])
        $.electionSystem.nominate("testSender4", ["nominate", vote1])
        $.electionSystem.nominate("testSender5", ["nominate", vote1])
        $.electionSystem.nominate("testSender6", ["nominate", vote1])
        $.electionSystem.nominate("testSender7", ["nominate", vote2])
        $.electionSystem.nominate("testSender8", ["nominate", vote2])
        $.electionSystem.nominate("testSender9", ["nominate", vote2])
        $.electionSystem.nominate("testSender10", ["nominate", vote2])
        $.electionSystem.nominate("testSender11", ["nominate", vote2])
        $.electionSystem.nominate("testSender12", ["nominate", vote2])
        $.electionSystem.nominate("testSender13", ["nominate", vote2])
        return [vote1, vote2]
    }

    function setUpVotes() {
        var votes = setUpNominations()
        vote1 = votes[0]
        $.electionSystem.startVoting()
        $.electionSystem.vote("testSender1", ['vote', vote1])
        $.electionSystem.vote("testSender2", ['vote', vote1])
        $.electionSystem.vote("testSender3", ['vote', vote1])
        $.electionSystem.vote("testSender4", ['vote', vote1])
        $.electionSystem.vote("testSender5", ['vote', vote1])
        $.electionSystem.vote("testSender6", ['vote', vote1])
        $.electionSystem.vote("testSender7", ['vote', vote1])
        $.electionSystem.vote("testSender8", ['vote', vote1])
        $.electionSystem.vote("testSender9", ['vote', vote1])
        $.electionSystem.vote("testSender10", ['vote', vote1])
        $.electionSystem.vote("testSender11", ['vote', vote1])
        $.electionSystem.vote("testSender12", ['vote', vote1])
        $.electionSystem.vote("testSender13", ['vote', vote1])
        $.electionSystem.vote("testSender14", ['vote', vote1])
        return votes
    }
})();