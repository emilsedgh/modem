var device = process.argv[2];
if(!device) {
  console.log('Usage: node callerid.js /path/to/device');
  process.exit();
}
var modem = require('../index.js').Modem();
modem.open(device, function() {
  modem.on('ring', function(msisdn) {
    console.log('Ringing', msisdn);
  });
});