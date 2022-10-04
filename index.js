const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const res = require('express/lib/response');
const app = express();

const port = process.env.Port || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bhpbrjb.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'UnAuthorized access' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'Forbidden access' })
    }
    req.decoded = decoded;
    next();
  });
}


async function run() {
  try {
    await client.connect();
    const serviceCollection = client.db('doctors_portal').collection('services');
    const bookingCollection = client.db('doctors_portal').collection('bookings');
    const userCollection = client.db('doctors_portal').collection('users');
    const doctorCollection = client.db('doctors_portal').collection('doctors');
    const transactionCollection = client.db('doctors_portal').collection('transactions');
    const reviewCollection = client.db('doctors_portal').collection('reviews');

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({ email: requester });
      if (requesterAccount.role === 'admin') {
        next();
      }
      else {
        res.status(403).send({ message: 'forbidden' });
      }
    }



    app.get('/service', async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get('/user', verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });


    app.get('/admin/:email', async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === 'admin';
      res.send({ admin: isAdmin })
    })

    app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: 'admin' },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    })


    app.put('/user/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
      res.send({ result, token });
    })

    app.get('/available', async (req, res) => {
      const date = req.query.date;

      // step 1:  get all services
      const services = await serviceCollection.find().toArray();

      // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      // step 3: for each service
      services.forEach(service => {
        // step 4: find bookings for that service. output: [{}, {}, {}, {}]
        const serviceBookings = bookings.filter(book => book.treatment === service.name);
        // step 5: select slots for the service Bookings: ['', '', '', '']
        const bookedSlots = serviceBookings.map(book => book.slot);
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(slot => !bookedSlots.includes(slot));
        //step 7: set available to slots to make it easier 
        service.slots = available;
      });


      res.send(services);
    })


    app.get('/booking', verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      try {
        const user = await userCollection.findOne({ email: patient });
        if (user.role && user.role === 'admin') {
          const bookings = await bookingCollection.find().toArray();
          return res.send(bookings);
        } else {
          const bookings = await bookingCollection.find({ patient: patient }).toArray();
          return res.send(bookings);
        }
      } catch (error) {
        console.log("ok")
        console.log(error.message)
      }
    })

    app.post('/booking', async (req, res) => {
      const booking = req.body;
      const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists })
      }
      booking.payment = 'unpaid'
      const result = await bookingCollection.insertOne(booking);
      return res.send({ success: true, result });
    })

    app.get('/doctor', verifyJWT, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    })


    app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    })


    app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
    })


    app.get('/get-token/:appointmentId', verifyJWT, async (req, res) => {
      const { appointmentId } = req.params;
      const token = Date.now() + appointmentId;
      try {
        const getApp = await bookingCollection.findOne({ _id: ObjectId(`${appointmentId}`) });

        const getToken = await transactionCollection.findOne({ appointmentId, date: getApp.date })

        if (getToken) {
          res.status(200).json({ token: getToken.token })
        } else {
          const obj = {
            appointmentId,
            token,
            status: true,
            date: getApp.date
          }
          await transactionCollection.insertOne(obj)
          res.status(201).json({ token })
        }
      } catch (error) {
        res.status(500).json({ error: 'internal server error' })
      }
    })

    app.post('/payment', verifyJWT, async (req, res) => {
      const { appointmentId, paymentToken } = req.body;
      try {
        const getApp = await bookingCollection.findOne({ _id: ObjectId(`${appointmentId}`) });

        const getToken = await transactionCollection.findOne({
          appointmentId,
          token: paymentToken,
          date: getApp.date
        })
        if (getToken.status) {
          await transactionCollection.updateOne({
            appointmentId,
            token: paymentToken,
            date: getApp.date
          }, {
            $set: {
              status: false
            }
          }, { upsert: true })
          await bookingCollection.updateOne({ _id: ObjectId(`${appointmentId}`) }, {
            $set: {
              payment: 'paid'
            }
          }, { upsert: true })
          res.status(200).json({ successMessage: 'payment success' })
        } else {
          res.status(404).json({ error: 'token is allrady use' })
        }
      } catch (error) {
        console.log(error)
        res.status(500).json({ error: 'internal server error' })
      }
    })

     //post review 
     app.post('/postReview', (req, res) => {
      const review = req.body;
      reviewCollection.insertOne(review)
          .then( result => {
              res.send(result.insertedCount > 0)
          })
      })
      //get review
      app.get('/getReview', (req, res) => {
          reviewCollection.find()
              .toArray((err, result) => {
                  res.send(result)
              })
      })
  }
  finally {

  }
}
run().catch(console.dir);




app.get('/', (req, res) => {
  res.send('Hello From Doctors Portal')
})

app.listen(port, () => {
  console.log(`Doctors app listening on port ${port}`)
})