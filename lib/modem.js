var pdu = require('pdu');
var sp = require('serialport');
var EventEmitter = require('events').EventEmitter;

var createModem = function() {
    var modem = new EventEmitter();

    modem.queue = []; //Holds queue of commands to be executed.
    modem.isLocked = false; //Device status
    modem.partials = {}; //List of stored partial messages
    modem.isOpened = false;
    modem.job_id = 1;
    modem.ussd_pdu = true; //Should USSD queries be done in PDU mode?

    //For each job, there will be a timeout stored here. We cant store timeout in item's themselves because timeout's are
    //circular objects and we want to JSON them to send them over sock.io which would be problematic.
    var timeouts = {};

    //Adds a command to execution queue.
    //Command is the AT command, c is callback. If prior is true, the command will be added to the beginning of the queue (It has priority).
    modem.execute = function(command, c, prior, timeout) {
        if(!this.isOpened) {
            this.emit('close');
            return ;
        }

        var item = new EventEmitter();
        item.command = command;
        item.callback = c;
        item.add_time = new Date();
        item.id = ++this.job_id;
        item.timeout = timeout;
        if(item.timeout == undefined) //Default timeout it 60 seconds. Send false to disable timeouts.
            item.timeout = 60000;

        if(prior)
            this.queue.unshift(item);
        else
            this.queue.push(item);

        this.emit('job', item);
        process.nextTick(this.executeNext.bind(this));
        return item;
    }

    //Executes the first item in the queue.
    modem.executeNext = function() {
        if(!this.isOpened) {
            this.emit('close');
            return ;
        }
        //Someone else is running. Wait.
        if(this.isLocked)
            return ;

        var item = this.queue[0];

        if(!item) {
            this.emit('idle');
            return ; //Queue is empty.
        }

        //Lock the device and null the data buffer for this command.
        this.data = '';
        this.isLocked = true;

        item.execute_time = new Date();

        item.emit('start');

        if(item.timeout)
            timeouts[item.id] = setTimeout(function() {
                item.emit('timeout');
                this.release();
                this.executeNext();
            }.bind(this), item.timeout);

        modem.port.write(item['command']+"\r");
    }

    modem.open = function(device, callback) {
        modem.port = new sp.SerialPort(device, {
            parser: sp.parsers.raw
        });

        modem.port.on('open', function() {
            modem.isOpened = true;

            modem.port.on('data', modem.dataReceived.bind(modem));

            modem.emit('open');

            if(callback)
                callback();
        });

        modem.port.on('close', function() {
            modem.port.close();
            modem.isOpened = false;
            modem.emit('close');
        });

        modem.port.on('error', function() {
            modem.close();
        });
    }

    modem.close = function(device) {
        this.port.removeAllListeners();
        this.port.close();
        this.port = null;
        this.isOpened = false;
        this.emit('close');
    }

    modem.dataReceived = function(buffer) {
        //We dont seriously expect such little amount of data. Ignore it.
        if(buffer.length < 2)
            return ;

        var datas = buffer.toString().trim().split('\r');

        datas.forEach(function(data) {
            // When we write to modem, it gets echoed.
            // Filter out queue we just executed.
            if(this.queue[0] && this.queue[0]['command'].trim().slice(0, data.length) === data) {
                this.queue[0]['command'] = this.queue[0]['command'].slice(data.length);
                return ;
            }

            //Emit received data for those who care.
            this.emit('data', data);


            if(data.trim().slice(0,5).trim() === '+CMTI') {
                this.smsReceived(data);
                return ;
            }

            if(data.trim().slice(0,5).trim() === '+CDSI') {
                this.deliveryReceived(data);
                return ;
            }

            if(data.trim().slice(0,5).trim() === '+CLIP') {
                this.ring(data);
                return ;
            }

            if(data.trim().slice(0,10).trim() === '^SMMEMFULL') {
                modem.emit('memory full', modem.parseResponse(data)[0]);
                return ;
            }

            //We are expecting results to a command. Modem, at the same time, is notifying us (of something).
            //Filter out modem's notification. Its not our response.
            if(this.queue[0] && data.trim().substr(0,1) === '^')
                return ;

            if(data.trim() === 'OK' || data.trim().match(/error/i) || data.trim() === '>') { //Command finished running.
                if(this.queue[0] && this.queue[0]['callback'])
                    var c = this.queue[0]['callback']
                else
                    var c = null;

                var allData = this.data;
                var delimeter = data.trim();

                /*
                Ordering of the following lines is important.
                First, we should release the modem. That will remove the current running item from queue.
                Then, we should call the callback. It might add another item with priority which will be added at the top of the queue.
                Then executeNext will execute the next command.
                */

                this.queue[0]['end_time'] = new Date();
                this.queue[0].emit('end', allData, data.trim());
                clearTimeout(timeouts[this.queue[0].id]);

                this.release();

                if(c)
                    c(allData, data.trim()); //Calling the callback and letting her know about data.

                this.executeNext();

            } else
                this.data += data; //Rest of data for a command. (Long answers will happen on multiple dataReceived events)
        }.bind(this));
    }

    modem.release = function() {
        this.data = ''; //Empty the result buffer.
        this.isLocked = false; //release the modem for next command.
        this.queue.shift(); //Remove current item from queue.
    }

    modem.smsReceived = function(cmti) {
        var message_info = this.parseResponse(cmti);
        var memory = message_info[0];
        this.execute('AT+CPMS="'+memory+'"', function(memory_usage) {
            var memory_usage = modem.parseResponse(memory_usage);
            var used  = parseInt(memory_usage[0]);
            var total = parseInt(memory_usage[1]);

            if(used === total)
                modem.emit('memory full', memory);
        });
        this.execute('AT+CMGR='+message_info[1], function(cmgr) {
            var lines = cmgr.trim().split("\n");
            var message = this.processReceivedPdu(lines[1], message_info[1]);
            if(message)
                this.emit('sms received', message);
        }.bind(this));
    }

    modem.deliveryReceived = function(delivery) {
        var response = this.parseResponse(delivery);
        this.execute('AT+CPMS="'+response[0]+'"');
        this.execute('AT+CMGR='+response[1], function(cmgr) {
            var lines = cmgr.trim().split("\n");
            var deliveryResponse = pdu.parseStatusReport(lines[1]);
            this.emit('delivery', deliveryResponse, response[1]);
        }.bind(this));
    }

    modem.ring = function(data) {
        var clip = this.parseResponse(data);
        modem.emit('ring', clip[0]);
    }

    modem.parseResponse = function(response) {
        var plain = response.slice(response.indexOf(':')+1).trim();
        var parts = plain.split(/,(?=(?:[^"]|"[^"]*")*$)/);
        for(i in parts)
            parts[i] = parts[i].replace(/\"/g, '');

        return parts;
    }

    modem.processReceivedPdu = function(pduString, index) {
        try {
            var message = pdu.parse(pduString);
        } catch(error) {
            return ;
        }
        message['indexes'] = [index];

        if(typeof(message['udh']) === 'undefined') //Messages has no data-header and therefore, is not contatenated.
            return message;

        if(message['udh']['iei'] !== '00' && message['udh']['iei'] !== '08') //Message has some data-header, but its not a contatenated message;
            return message;

        var messagesId = message.sender+'_'+message.udh.reference_number;
        if(typeof(this.partials[messagesId]) === 'undefined')
            this.partials[messagesId] = [];

        this.partials[messagesId].push(message);
        if(this.partials[messagesId].length < message.udh.parts)
            return ;

        var text = '';
        var indexes = [];

        for(var i = 0; i<message.udh.parts;i++)
            for(var j = 0; j<message.udh.parts;j++)
                if(this.partials[messagesId][j].udh.current_part === i+1) {
                    text += this.partials[messagesId][j].text;
                    indexes.push(this.partials[messagesId][j].indexes[0]);
                    continue ;
                }
        message['text'] = text; //Update text.
        message['indexes'] = indexes; //Update idex list.

        delete this.partials[messagesId]; //Remove from partials list.

        return message;
    }

    modem.getMessages = function(callback) {
        this.execute('AT+CMGL=1', function(data) {
            var messages = [];
            var lines = data.split("\n"); //TODO: \n AND \r\n
            var i = 0;
            lines.forEach(function(line) {
                if(line.trim().length === 0)
                    return;

                if(line.slice(0,1) === '+') {
                    i = modem.parseResponse(line)[0];
                    return ;
                }

                var message = this.processReceivedPdu(line, i);
                if(message)
                    messages.push(message);
            }.bind(this));

            if(callback)
                callback(messages);
        }.bind(this));
    }

    modem.sms = function(message, callback) {
        var i = 0;
        var pdus = pdu.generate(message);
        var ids = [];

        //sendPDU executes 'AT+CMGS=X' command. The modem will give a '>' in response.
        //Then, appendPdu should append the PDU+^Z 'immediately'. Thats why the appendPdu executes the pdu using priority argument of modem.execute.
        var sendPdu = function(pdu) { // Execute 'AT+CMGS=X', which means modem should get ready to read a PDU of X bytes.
            this.execute("AT+CMGS="+((pdu.length/2)-1), appendPdu);
        }.bind(this);

        var appendPdu = function(response, escape_char) { //Response to a AT+CMGS=X is '>'. Which means we should enter PDU. If aything else has been returned, there's an error.
            if(escape_char !== '>')
                return callback(response+' '+escape_char); //An error has happened.

            var job = this.execute(pdus[i]+String.fromCharCode(26), function(response, escape_char) {
                if(escape_char.match(/error/i))
                    return callback(response+' '+escape_char);

                var response = this.parseResponse(response);

                ids.push(response[0]);
                i++;

                if(typeof(pdus[i]) === 'undefined') {
                    if(callback)
                        callback(null, ids); //We've pushed all PDU's and gathered their ID's. calling the callback.
                        modem.emit('sms sent', message, ids);
                } else {
                    sendPdu(pdus[i]); //There's at least one more PDU to send.
                }
            }.bind(this), true, false);

        }.bind(this);

        sendPdu(pdus[i]);
    }

    modem.on('newListener', function(listener) {
        //If user wants to get sms events, we have to ask modem to give us notices.
        if(listener == 'sms received')
            this.execute('AT+CNMI=2,1,0,2,0');

        if(listener == 'ring')
            this.execute('AT+CLIP=1');
    });

    modem.deleteMessage = function(index, cb) {
        modem.execute('AT+CMGD='+index);
    }

    return modem;
}

module.exports = createModem;
