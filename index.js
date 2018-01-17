
const http = require('http');
const fs = require('fs');
const Web3 = require('web3');
const uportConnect = require('uport-connect')
const UPORT = require('uport')
const mnid = require('mnid')
const url = require('url');

// config
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
const hostname = config.hostname
const port = config.port
const network = config.network
const abiFile = config.abiFile

const secret = JSON.parse(fs.readFileSync('./config-secret.json', 'utf8'))
const ethereumUrl = secret.ethereumUrl
const clientId = secret.clientId
const key = secret.key

var uport;
var specificNetworkAddress = null;
var decodedId = null;
var creds = null;
var pendingJobs = Array();

const web3 = new Web3(new Web3.providers.HttpProvider(ethereumUrl));

// setup contract
const contractAddress = '0xd60e1a150b59a89a8e6e6ff2c03ffb6cb4096205'
const abi = JSON.parse(fs.readFileSync(abiFile, 'utf8'))
const contract = new web3.eth.Contract(abi, contractAddress)

// setup server
const server = http.createServer((req, res) => {
  console.log("got request", req.url);
  if(req.url.includes("addModel")) {
    var q = url.parse(req.url, true).query

    addModel(q.model, (modelId) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end();
    })
  } else if(req.url.includes("addWeights")) {
    var q = url.parse(req.url, true).query

    addWeights(q.model, q.weights, () => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end();
    })
  } else {
    login((uri) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end(uri);
    })
  }
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

function addressToArray (ipfsAddress) {
  const targetLength = 64 // fill the address with 0 at the end to this length
  const parts = ipfsAddress.match(/.{1,32}/g) // split into 32-chars
  .map(part => part.split('').map(c => c.charCodeAt(0).toString(16)).join('')) // turn each part into a hexString address
  .map(part => part.concat('0'.repeat(targetLength - part.length))) // 0 pad at the end
  .map(part => '0x' + part) // prefix as hex
  return parts
}

function connectUport(cb) {
  return new uportConnect.Connect('OpenMined', {
    clientId: clientId,
    network: network,
    signer: uportConnect.SimpleSigner(key),
    uriHandler: (uri) => {
      cb(uri)
      console.log('uportConnect.Connect uri', uri)
    }
  })
}


var addModelFunc = {
  name : "addModel",
  type : "function",
  inputs: [
    {
      name: "_weights",
      type: "bytes32[]"
    },
    {
      name: "initial_error",
      type: "uint256"
    },
    {
      name: "target_error",
      type: "uint256"
    }
  ],
}

function addModel(modelAddress, cb) {
  var modelAddressArray = addressToArray(modelAddress);

  console.log("added model for address: ", modelAddressArray);

  const data = web3.eth.abi.encodeFunctionCall(addModelFunc,
                                               [modelAddressArray, 0, 0]);

  const params = {
    from: specificNetworkAddress,
    data: data,
    gas: 500000,
    to: contractAddress
  }

  uport.sendTransaction(params).then(txResponse => {
    console.log('txResponse', txResponse)
  })
  .catch(err => console.error(err))

  cb(1);
}

var addGradientsFunc = {
    name: 'addGradient',
    type: 'function',
    inputs: [{
      type: 'uint256',
      name: 'model_id'
    }, {
      type: 'bytes32[]',
      name: '_grad_addr'
    }]
}

function addWeights(modelId, weightsAddress, cb) {
  var weightsAddressArray = addressToArray(weightsAddress);

  console.log("add weights for model: ", modelId, " for: ", weightsAddressArray);

  const data = web3.eth.abi.encodeFunctionCall(addGradientsFunc,
                                              [modelId, weightsAddressArray]);

  if(specificNetworkAddress == null) {
    pendingJobs.push(data)
  } else {
    const params = {
      from: specificNetworkAddress,
      data: data,
      gas: 500000,
      to: contractAddress
    }

    uport.sendTransaction(params).then(txResponse => {
      console.log('txResponse', txResponse)
    })
    .catch(err => console.error(err))
  }

  cb(1);
}

function login(cb) {
  uport = connectUport(cb);

  // Request credentials to login
  uport.requestCredentials({
    requested: ['name', 'phone', 'country'],
    notifications: true, // We want this if we want to recieve credentials
    uriHandler: (uri) => {
      console.log('uport.requestCredentials uri', uri)
    }
  })
  .then((credentials) => {

    console.log("credentials", credentials)

    creds = credentials;
    decodedId = mnid.decode(credentials.address)
    console.log('decodedId', decodedId)

    specificNetworkAddress = decodedId.address
    console.log('specificNetworkAddress', specificNetworkAddress)

    contract.methods['getNumModels']().call({from:specificNetworkAddress}).then(modelCount => {
      console.log('modelCount', modelCount)
    })

    if(pendingJobs.length > 0) {
      for(var i = 0; i < pendingJobs.length; i++) {
        const params = {
          from: specificNetworkAddress,
          data: pendingJobs[i],
          gas: 500000,
          to: contractAddress
        }

        uport.sendTransaction(params).then(txResponse => {
          console.log('txResponse', txResponse)
        })
        .catch(err => console.error(err))
      }
    }
  })
  .catch(err => console.error(err))
}
