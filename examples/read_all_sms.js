/* Usage: node read_all_sms.js /path/to/device */

function err(message) {
  console.log('Usage: node read_all_sms.js /path/to/device');
  process.exit();
}

var device   = process.argv[2];

if(!device) err();

var modem = require('../index.js').Modem();
modem.open(device, function() {
  modem.getMessages(function() {
    console.log(arguments);
  })

  modem.on('sms received', function(sms) {
    console.log(sms);
  });
});