var modem = require('../index.js').Modem();
modem.open('/dev/ttyUSB0', function() {
  modem.getMessages(function() {
    console.log(arguments);
  })

  modem.on('sms received', function(sms) {
    console.log(sms);
  });
});