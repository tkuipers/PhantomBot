(function() {
	var presidentSystem = {
        PRESIDENT_ARG: 'president',
        GIVE_ARG: 'give',
        TEST_ARG: 'test',
		TIMEOUT_ARG: 'ban',
        UNTIMEOUT_ARG: 'unban',
        banReason: $.getSetIniDbString('presidentSettings', 'presidentbanmessage', 'The president has banned you'),
        giveLength: $.getSetIniDbNumber('presidentSettings', 'givelength', 60),
        president: undefined,
        shouldTalk: true,
        endTime: 0,
        isAlreadyVIP: false,
        giveTimeout: undefined,

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
            this.whisper(sender, 'Usage: !' + this.PRESIDENT_ARG + ' ' + this.TIMEOUT_ARG + '/' + this.UNTIMEOUT_ARG + ' <username>')
        },

        /**
        * Whisper a command to a user
        */
        whisper: function(sender, message){
            this.say($.whisperPrefix(sender) + message);
        },

		validateArgs: function(args, sender){
            if(args[0] == 'test'){
                return true
            }
			if(sender.equalsIgnoreCase($.electionSystem.president)){
				if(args[1] === undefined){
					this.whisperUsage(sender)
					return false
				}
				return true
			}
			return false
        },
        
        ban: function(args){
            userToBan = args[1]
            banTime = this.endTime - $.systemTime()
            $.timeoutUser(userToBan, banTime, this.banReason)
        },

        unban: function(args){
            userToBan = args[1]
            banTime = 1
            $.timeoutUser(userToBan, banTime, this.banReason)
        },

        setVIP: function(user, vip){
            if(vip){
                $.session.say(".vip " + user)
            }
            else{
                $.session.say(".unvip " + user)
            }
        },

        give: function(args){
            this.endPresidency()
            user = args[1]
            this.president = $.user.sanitize(user)
            this.endTime = $.systemTime() + (this.giveLength * 1e3)
            this.beginPresidency()
            clearTimeout(this.giveTimeout)
            this.timeout = setTimeout(function() {
                this.endPresidency()
            }, this.giveLength * 1e3)

        },

        beginPresidency: function(){
            this.president = $.user.sanitize(this.president)
            if(!$.isVIP(this.president)){
                this.isAlreadyVIP = false
                this.setVIP(this.president, true)
            }
            else{
                this.isAlreadyVIP = true
            }
        },

        endPresidency: function() {
            if(!this.isAlreadyVIP){
                this.setVIP(this.president, false)
            }
            this.president = undefined
            this.endTime = 0
        },
		
		stateChange: function(state, extraArgs){
            if(state == $.electionSystem.possibleStates.PRESIDENTIAL_TERM && extraArgs['president'] && extraArgs['endTime'] !== undefined){
                this.president = extraArgs['president']
                this.endTime = extraArgs['endTime']
                this.beginPresidency()
            }
            else if(state == $.electionSystem.possibleStates.NONE){
                this.endPresidency()
            }
        }

	}

	$.presidentSystem = presidentSystem

	$.bind('command', function(event) {
        var sender = event.getSender(),
            command = event.getCommand(),
            args = event.getArgs(),
            action = args[0]
        if(command.equalsIgnoreCase($.presidentSystem.PRESIDENT_ARG)){
            if($.presidentSystem.validateArgs(args, sender)){
                //simple validation of arguments has confirmed that they aren't impossible
                if(action.equalsIgnoreCase($.presidentSystem.TIMEOUT_ARG)){
                    $.presidentSystem.ban(args)
                }
                else if(action.equalsIgnoreCase($.presidentSystem.UNTIMEOUT_ARG)){
                    $.presidentSystem.unban(args)
                }
                else if(action.equalsIgnoreCase($.presidentSystem.GIVE_ARG)){
                    $.presidentSystem.give(args)
                }
                else if(action.equalsIgnoreCase($.presidentSystem.TEST_ARG)){
                    test()
                }
            }
        }
    })

	$.bind('initReady', function() {
		$.registerChatCommand('./systems/presidentSystem.js', presidentSystem.PRESIDENT_ARG, 7);
        $.registerChatSubcommand(presidentSystem.PRESIDENT_ARG, presidentSystem.TIMEOUT_ARG, 7);
        $.registerChatSubcommand(presidentSystem.PRESIDENT_ARG, presidentSystem.UNTIMEOUT_ARG, 7);
        $.registerChatSubcommand(presidentSystem.PRESIDENT_ARG, presidentSystem.GIVE_ARG, 2);
        $.electionSystem.subscribe(presidentSystem)
    })
})();