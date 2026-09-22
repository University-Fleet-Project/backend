const paths = {};

const json = (schema, example) => ({
  required: true,
  content: {
    'application/json': {
      schema,
      ...(example ? { example } : {})
    }
  }
});

const ref = name => ({ $ref: `#/components/schemas/${name}` });

const bodyRef = (name, example) => json(ref(name), example);

const pathParam = (name, description = '') => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' }
});

const queryParam = (name, type = 'string', description = '', example) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: { type },
  ...(example !== undefined ? { example } : {})
});

function operation(summary, {
  auth = true,
  roles,
  params = [],
  body,
  responses = {},
  description
} = {}) {
  const op = {
    summary,
    ...(description ? { description } : {}),
    tags: [],
    ...(auth ? { security: [{ bearerAuth: [] }] } : { security: [] }),
    ...(roles?.length ? { 'x-roles': roles } : {}),
    ...(params.length ? { parameters: params } : {}),
    ...(body ? { requestBody: body } : {}),
    responses: {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: ref('Success')
          }
        }
      },
      '400': {
        description: 'Validation error',
        content: {
          'application/json': {
            schema: ref('Error')
          }
        }
      },
      '401': {
        description: 'Authentication required or invalid credentials',
        content: {
          'application/json': {
            schema: ref('Error')
          }
        }
      },
      '403': {
        description: 'Forbidden',
        content: {
          'application/json': {
            schema: ref('Error')
          }
        }
      },
      '404': {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: ref('Error')
          }
        }
      },
      '409': {
        description: 'Conflict',
        content: {
          'application/json': {
            schema: ref('Error')
          }
        }
      },
      ...responses
    }
  };
  return op;
}

function add(path, method, summary, options = {}) {
  if (!paths[path]) paths[path] = {};
  const op = operation(summary, options);
  op.tags = [tagFor(path)];
  paths[path][method] = op;
}

function tagFor(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'api' && parts[1] === 'v1') return parts[2] || 'API';
  return parts[0] || 'API';
}

/* ----------------------------- Schemas ----------------------------- */

const schemas = {
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        example: 'abdelrahman.araby@fleet.demo'
      },
      password: {
        type: 'string',
        format: 'password',
        example: 'password'
      }
    }
  },

  RefreshRequest: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: {
        type: 'string',
        example: 'paste-refresh-token-here'
      }
    }
  },

  ChangePasswordRequest: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: {
        type: 'string',
        format: 'password',
        example: 'password'
      },
      newPassword: {
        type: 'string',
        format: 'password',
        minLength: 6,
        example: 'new-password-123'
      }
    }
  },

  UserCreateRequest: {
    type: 'object',
    required: ['name', 'role', 'email'],
    properties: {
      name: { type: 'string', example: 'Ahmed Ali' },
      role: {
        type: 'string',
        enum: ['requester', 'dispatcher', 'driver', 'fleet_admin', 'auditor'],
        example: 'requester'
      },
      email: { type: 'string', format: 'email', example: 'ahmed@fleet.demo' },
      password: { type: 'string', format: 'password', example: 'password' }
    }
  },

  UserUpdateRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', example: 'Ahmed Ali' },
      role: {
        type: 'string',
        enum: ['requester', 'dispatcher', 'driver', 'fleet_admin', 'auditor'],
        example: 'requester'
      },
      email: { type: 'string', format: 'email', example: 'ahmed@fleet.demo' }
    }
  },

  UserRegisterRequest: {
    type: 'object',
    required: ['name', 'role', 'email'],
    properties: {
      name: { type: 'string', example: 'Ahmed Ali' },
      role: {
        type: 'string',
        enum: ['requester', 'dispatcher', 'driver', 'fleet_admin', 'auditor'],
        example: 'requester'
      },
      email: { type: 'string', format: 'email', example: 'ahmed@fleet.demo' },
      password: { type: 'string', format: 'password', example: 'password' }
    }
  },

  UserStatusRequest: {
    type: 'object',
    required: ['status'],
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'inactive'],
        example: 'active'
      }
    }
  },

  VehicleCreateRequest: {
    type: 'object',
    required: ['vehicleId'],
    properties: {
      vehicleId: { type: 'string', example: 'FLT-V-031' },
      vehicleType: { type: 'string', example: 'Sedan' },
      make: { type: 'string', example: 'Toyota' },
      model: { type: 'string', example: 'Corolla' },
      vehicleYear: { type: 'integer', example: 2025 },
      seats: { type: 'integer', example: 5 },
      fuelType: { type: 'string', example: 'gasoline' },
      nominalLPer100Km: { type: 'number', example: 7.2 },
      allowedLoad: { type: 'number', example: 450 },
      status: {
        type: 'string',
        enum: ['available', 'unavailable', 'maintenance', 'inactive'],
        example: 'available'
      },
      plateNumber: { type: 'string', example: 'ABC-123' },
      transmission: { type: 'string', example: 'automatic' },
      tankCapacity: { type: 'number', example: 50 },
      accessibilityFeatures: { type: 'string', example: 'wheelchair ramp' },
      currentOdometer: { type: 'number', example: 12500 }
    }
  },

  VehicleUpdateRequest: {
    type: 'object',
    properties: {
      vehicleType: { type: 'string', example: 'Sedan' },
      make: { type: 'string', example: 'Toyota' },
      model: { type: 'string', example: 'Corolla' },
      vehicleYear: { type: 'integer', example: 2025 },
      seats: { type: 'integer', example: 5 },
      fuelType: { type: 'string', example: 'gasoline' },
      nominalLPer100Km: { type: 'number', example: 7.2 },
      allowedLoad: { type: 'number', example: 450 },
      plateNumber: { type: 'string', example: 'ABC-123' },
      transmission: { type: 'string', example: 'automatic' },
      tankCapacity: { type: 'number', example: 50 },
      accessibilityFeatures: { type: 'string', example: 'wheelchair ramp' }
    }
  },

  VehicleStatusRequest: {
    type: 'object',
    required: ['status'],
    properties: {
      status: {
        type: 'string',
        enum: ['available', 'unavailable', 'maintenance', 'inactive'],
        example: 'available'
      }
    }
  },

  VehicleAvailabilityRequest: {
    type: 'object',
    required: ['vehicleId', 'startTime', 'endTime'],
    properties: {
      vehicleId: { type: 'string', example: 'FLT-V-001' },
      startTime: { type: 'string', format: 'date-time', example: '2026-09-22T09:00:00' },
      endTime: { type: 'string', format: 'date-time', example: '2026-09-22T12:00:00' }
    }
  },

  OdometerRequest: {
    type: 'object',
    required: ['value'],
    properties: {
      value: { type: 'number', example: 12550 },
      recordedAt: { type: 'string', format: 'date-time', example: '2026-09-21T18:00:00' }
    }
  },

  VehiclePhotoCreateRequest: {
    type: 'object',
    required: ['imageUrl'],
    properties: {
      imageUrl: { type: 'string', example: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341' },
      caption: { type: 'string', example: 'Front bumper view' }
    }
  },

  ReservationCreateRequest: {
    type: 'object',
    required: [
      'vehicleId',
      'startTime',
      'endTime',
      'origin',
      'destination',
      'passengers',
      'distanceKm'
    ],
    properties: {
      vehicleId: { type: 'string', example: 'FLT-V-001' },
      startTime: { type: 'string', format: 'date-time', example: '2026-09-22T09:00:00' },
      endTime: { type: 'string', format: 'date-time', example: '2026-09-22T12:00:00' },
      origin: {
        oneOf: [
          { type: 'string', example: 'University Campus' },
          {
            type: 'object',
            additionalProperties: true,
            example: {
              name: 'University Campus',
              latitude: 27.18,
              longitude: 31.18
            }
          }
        ]
      },
      destination: {
        oneOf: [
          { type: 'string', example: 'Assiut Airport' },
          {
            type: 'object',
            additionalProperties: true,
            example: {
              name: 'Assiut Airport',
              latitude: 27.05,
              longitude: 31.01
            }
          }
        ]
      },
      passengers: { type: 'integer', example: 3 },
      load: { type: 'number', example: 50 },
      distanceKm: { type: 'number', example: 35 },
      comment: { type: 'string', example: 'Official trip for university delegation' },
      notes: { type: 'string', example: 'Official trip for university delegation' }
    }
  },

  ReservationCancelRequest: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        example: 'Schedule changed'
      }
    }
  },

  ReservationDecisionRequest: {
    type: 'object',
    properties: {
      vehicleId: { type: 'string', example: 'FLT-V-001' },
      driverId: { type: 'integer', example: 1 },
      reason: { type: 'string', example: 'Approved after availability check' }
    }
  },

  ReservationRejectRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string', example: 'Vehicle unavailable' }
    }
  },

  DriverCreateRequest: {
    type: 'object',
    required: ['userId', 'licenseNumber'],
    properties: {
      userId: { type: 'integer', example: 2 },
      status: { type: 'string', example: 'available' },
      licenseNumber: { type: 'string', example: 'DL-123456' }
    }
  },

  DriverUpdateRequest: {
    type: 'object',
    properties: {
      userId: { type: 'integer', example: 2 },
      status: { type: 'string', example: 'available' },
      licenseNumber: { type: 'string', example: 'DL-123456' }
    }
  },

  QualificationRequest: {
    type: 'object',
    required: ['qualification'],
    properties: {
      qualification: { type: 'string', example: 'Heavy Vehicle' },
      validFrom: { type: 'string', format: 'date', example: '2026-01-01' },
      validTo: { type: 'string', format: 'date', example: '2027-01-01' },
      status: { type: 'string', example: 'valid' }
    }
  },

  RouteEstimateRequest: {
    type: 'object',
    required: ['origin', 'destination'],
    properties: {
      reservationId: { type: 'string', nullable: true, example: 'FLT-RES-0001' },
      origin: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', example: 27.18 },
          longitude: { type: 'number', example: 31.18 }
        }
      },
      destination: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', example: 27.05 },
          longitude: { type: 'number', example: 31.01 }
        }
      }
    }
  },

  FuelEstimateRequest: {
    type: 'object',
    required: ['vehicleId', 'routeDistanceKm'],
    properties: {
      reservationId: { type: 'string', nullable: true, example: 'FLT-RES-0001' },
      vehicleId: { type: 'string', example: 'FLT-V-001' },
      routeDistanceKm: { type: 'number', example: 120 },
      trafficBand: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        example: 'medium'
      },
      acUsage: { type: 'boolean', example: true }
    }
  },

  TripAssignRequest: {
    type: 'object',
    required: ['vehicleId', 'driverId'],
    properties: {
      vehicleId: { type: 'string', example: 'FLT-V-001' },
      driverId: { type: 'integer', example: 1 },
      reason: { type: 'string', example: 'Dispatcher assignment' }
    }
  },

  TripDispatchRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string', example: 'Ready for dispatch' }
    }
  },

  TripStartRequest: {
    type: 'object',
    required: ['odometerStart'],
    properties: {
      odometerStart: { type: 'number', example: 12500 },
      latitude: { type: 'number', example: 27.18 },
      longitude: { type: 'number', example: 31.18 },
      timestamp: { type: 'string', format: 'date-time', example: '2026-09-22T09:00:00Z' }
    }
  },

  LocationRequest: {
    type: 'object',
    required: ['latitude', 'longitude', 'timestamp'],
    properties: {
      latitude: { type: 'number', example: 27.18 },
      longitude: { type: 'number', example: 31.18 },
      timestamp: { type: 'string', format: 'date-time', example: '2026-09-22T09:30:00Z' },
      accuracyMeters: { type: 'number', example: 10 },
      speedKmh: { type: 'number', example: 35 }
    }
  },

  TripCompleteRequest: {
    type: 'object',
    required: ['odometerEnd', 'actualDistanceKm', 'actualFuelLiters'],
    properties: {
      odometerEnd: { type: 'number', example: 12545 },
      actualDistanceKm: { type: 'number', example: 45 },
      actualFuelLiters: { type: 'number', example: 5.2 },
      notes: { type: 'string', example: 'Trip completed normally' }
    }
  },

  FuelTransactionRequest: {
    type: 'object',
    required: ['liters', 'cost'],
    properties: {
      liters: { type: 'number', example: 20 },
      cost: { type: 'number', example: 500 },
      odometer: { type: 'number', example: 12545 },
      timestamp: { type: 'string', format: 'date-time', example: '2026-09-22T12:00:00Z' }
    }
  },

  BrandRequest: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', example: 'Toyota' }
    }
  },

  ModelRequest: {
    type: 'object',
    required: ['name'],
    properties: {
      brandId: { type: 'integer', nullable: true, example: 1 },
      name: { type: 'string', example: 'Corolla' }
    }
  },

  SpecificationRequest: {
    type: 'object',
    properties: {
      nominalLPer100Km: { type: 'number', example: 7.2 },
      tankCapacity: { type: 'number', example: 50 },
      accessibility: { type: 'string', example: 'wheelchair ramp' },
      transmission: { type: 'string', example: 'automatic' },
      allowedLoad: { type: 'number', example: 450 }
    }
  },

  MaintenanceRequest: {
    type: 'object',
    properties: {
      maintenanceType: { type: 'string', example: 'Oil Change' },
      description: { type: 'string', example: 'Routine engine oil change' },
      startAt: { type: 'string', format: 'date-time', example: '2026-09-22T08:00:00Z' },
      endAt: { type: 'string', format: 'date-time', example: '2026-09-22T10:00:00Z' },
      status: { type: 'string', example: 'open' }
    }
  },

  Error: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string', example: 'Validation failed.' },
          details: { nullable: true, example: null }
        }
      }
    }
  },

  Success: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: true
          },
          {
            type: 'array',
            items: {}
          },
          {
            type: 'string',
            nullable: true
          }
        ]
      },
      message: { type: 'string', example: 'Success' }
    }
  }
};

/* ----------------------------- Auth ----------------------------- */

add('/api/v1/auth/login', 'post', 'Login', {
  auth: false,
  body: bodyRef('LoginRequest', {
    email: 'abdelrahman.araby@fleet.demo',
    password: 'password'
  }),
  responses: {
    '200': {
      description: 'Login successful',
      content: {
        'application/json': {
          schema: ref('Success')
        }
      }
    }
  }
});

add('/api/v1/auth/refresh', 'post', 'Refresh access token', {
  auth: false,
  body: bodyRef('RefreshRequest', {
    refreshToken: 'paste-refresh-token-here'
  })
});

add('/api/v1/auth/logout', 'post', 'Logout');

add('/api/v1/auth/me', 'get', 'Current user');

add('/api/v1/auth/change-password', 'post', 'Change password', {
  body: bodyRef('ChangePasswordRequest', {
    currentPassword: 'password',
    newPassword: 'new-password-123'
  })
});

/* ----------------------------- Users ----------------------------- */

add('/api/v1/users', 'get', 'List users', {
  roles: ['fleet_admin', 'dispatcher', 'auditor'],
  params: [
    queryParam('role', 'string', 'Filter by role'),
    queryParam('search', 'string', 'Search by user name'),
    queryParam('page', 'integer', 'Page number', 1),
    queryParam('limit', 'integer', 'Page size', 20)
  ]
});

add('/api/v1/users', 'post', 'Create user', {
  roles: ['fleet_admin'],
  body: bodyRef('UserCreateRequest', {
    name: 'Ahmed Ali',
    role: 'requester',
    email: 'ahmed@fleet.demo',
    password: 'password'
  })
});

add('/api/v1/users/{id}', 'get', 'Get user', {
  params: [pathParam('id', 'User ID')]
});

add('/api/v1/users/{id}', 'put', 'Update user', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'User ID')],
  body: bodyRef('UserUpdateRequest', {
    name: 'Ahmed Ali',
    role: 'requester',
    email: 'ahmed@fleet.demo'
  })
});

add('/api/v1/users/{id}/status', 'patch', 'Activate/deactivate user', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'User ID')],
  body: bodyRef('UserStatusRequest', { status: 'active' })
});

add('/api/v1/users/register', 'post', 'Register user', {
  auth: false,
  body: bodyRef('UserRegisterRequest', {
    name: 'Ahmed Ali',
    role: 'requester',
    email: 'ahmed@fleet.demo',
    password: 'password'
  })
});

/* ----------------------------- Vehicles ----------------------------- */

add('/api/v1/vehicles', 'get', 'List/filter vehicles', {
  params: [
    queryParam('type'),
    queryParam('model'),
    queryParam('minSeats', 'integer'),
    queryParam('maxSeats', 'integer'),
    queryParam('transmission'),
    queryParam('fuelType'),
    queryParam('accessibility', 'boolean'),
    queryParam('status'),
    queryParam('search'),
    queryParam('brandId'),
    queryParam('page', 'integer', 'Page number', 1),
    queryParam('limit', 'integer', 'Page size', 20)
  ]
});

add('/api/v1/vehicles', 'post', 'Create vehicle', {
  roles: ['fleet_admin'],
  body: bodyRef('VehicleCreateRequest', {
    vehicleId: 'FLT-V-031',
    vehicleType: 'Sedan',
    make: 'Toyota',
    model: 'Corolla',
    vehicleYear: 2025,
    seats: 5,
    fuelType: 'gasoline',
    nominalLPer100Km: 7.2,
    allowedLoad: 450,
    status: 'available',
    plateNumber: 'ABC-123',
    transmission: 'automatic',
    tankCapacity: 50,
    accessibilityFeatures: '',
    currentOdometer: 12500
  })
});

add('/api/v1/vehicles/{id}', 'get', 'Vehicle details', {
  params: [pathParam('id', 'Vehicle ID, e.g. FLT-V-001')]
});

add('/api/v1/vehicles/{id}', 'put', 'Update vehicle', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'Vehicle ID')],
  body: bodyRef('VehicleUpdateRequest', {
    model: 'Corolla',
    seats: 5,
    status: 'available'
  })
});

add('/api/v1/vehicles/{id}', 'delete', 'Archive vehicle', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'Vehicle ID')]
});

add('/api/v1/vehicles/{id}/status', 'patch', 'Change vehicle status', {
  roles: ['fleet_admin', 'dispatcher'],
  params: [pathParam('id', 'Vehicle ID')],
  body: bodyRef('VehicleStatusRequest', { status: 'available' })
});

add('/api/v1/vehicles/{id}/availability', 'get', 'Vehicle availability', {
  params: [
    pathParam('id', 'Vehicle ID'),
    queryParam('from', 'string', 'Availability window start'),
    queryParam('to', 'string', 'Availability window end')
  ]
});

add('/api/v1/vehicles/check-availability', 'post', 'Check vehicle availability', {
  body: bodyRef('VehicleAvailabilityRequest', {
    vehicleId: 'FLT-V-001',
    startTime: '2026-09-22T09:00:00',
    endTime: '2026-09-22T12:00:00'
  })
});

add('/api/v1/vehicles/{id}/odometer', 'get', 'Odometer history', {
  params: [pathParam('id', 'Vehicle ID')]
});

add('/api/v1/vehicles/{id}/odometer', 'post', 'Record odometer', {
  params: [pathParam('id', 'Vehicle ID')],
  body: bodyRef('OdometerRequest', {
    value: 12550,
    recordedAt: '2026-09-21T18:00:00'
  })
});

add('/api/v1/vehicles/{vehicleId}/photos', 'get', 'List vehicle photos', {
  params: [pathParam('vehicleId', 'Vehicle ID')]
});

add('/api/v1/vehicles/{vehicleId}/photos', 'post', 'Add vehicle photo', {
  roles: ['fleet_admin', 'dispatcher'],
  params: [pathParam('vehicleId', 'Vehicle ID')],
  body: bodyRef('VehiclePhotoCreateRequest', {
    imageUrl: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341',
    caption: 'Front view'
  })
});

add('/api/v1/vehicles/{vehicleId}/photos/{photoId}', 'delete', 'Delete vehicle photo', {
  roles: ['fleet_admin', 'dispatcher'],
  params: [
    pathParam('vehicleId', 'Vehicle ID'),
    pathParam('photoId', 'Photo ID')
  ]
});

/* ----------------------------- Brands / Models / Specs ----------------------------- */

add('/api/v1/brands', 'get', 'List brands');

add('/api/v1/brands', 'post', 'Create brand', {
  roles: ['fleet_admin'],
  body: bodyRef('BrandRequest', { name: 'Toyota' })
});

add('/api/v1/brands/{id}', 'put', 'Update brand', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'Brand ID')],
  body: bodyRef('BrandRequest', { name: 'Toyota' })
});

add('/api/v1/brands/{id}', 'delete', 'Delete brand', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'Brand ID')]
});

add('/api/v1/models', 'get', 'List models');

add('/api/v1/models', 'post', 'Create model', {
  roles: ['fleet_admin'],
  body: bodyRef('ModelRequest', {
    brandId: 1,
    name: 'Corolla'
  })
});

add('/api/v1/models/{id}', 'put', 'Update model', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'Model ID')],
  body: bodyRef('ModelRequest', {
    brandId: 1,
    name: 'Corolla'
  })
});

add('/api/v1/models/{id}', 'delete', 'Delete model', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'Model ID')]
});

add('/api/v1/vehicle-specifications/{vehicleId}', 'get', 'Get specifications', {
  params: [pathParam('vehicleId', 'Vehicle ID')]
});

add('/api/v1/vehicle-specifications/{vehicleId}', 'put', 'Update specifications', {
  roles: ['fleet_admin'],
  params: [pathParam('vehicleId', 'Vehicle ID')],
  body: bodyRef('SpecificationRequest', {
    nominalLPer100Km: 7.2,
    tankCapacity: 50,
    accessibility: '',
    transmission: 'automatic',
    allowedLoad: 450
  })
});

/* ----------------------------- Drivers ----------------------------- */

add('/api/v1/drivers', 'get', 'List drivers', {
  params: [
    queryParam('search'),
    queryParam('status'),
    queryParam('qualification'),
    queryParam('available', 'boolean'),
    queryParam('page', 'integer', 'Page number', 1),
    queryParam('limit', 'integer', 'Page size', 20)
  ]
});

add('/api/v1/drivers', 'post', 'Create driver', {
  roles: ['fleet_admin'],
  body: bodyRef('DriverCreateRequest', {
    userId: 2,
    status: 'available',
    licenseNumber: 'DL-123456'
  })
});

add('/api/v1/drivers/{id}', 'get', 'Driver details', {
  params: [pathParam('id', 'Driver ID')]
});

add('/api/v1/drivers/{id}', 'put', 'Update driver', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'Driver ID')],
  body: bodyRef('DriverUpdateRequest', {
    status: 'available',
    licenseNumber: 'DL-123456'
  })
});

add('/api/v1/drivers/{id}/qualifications', 'get', 'Driver qualifications', {
  params: [pathParam('id', 'Driver ID')]
});

add('/api/v1/drivers/{id}/qualifications', 'post', 'Add qualification', {
  roles: ['fleet_admin'],
  params: [pathParam('id', 'Driver ID')],
  body: bodyRef('QualificationRequest', {
    qualification: 'Heavy Vehicle',
    validFrom: '2026-01-01',
    validTo: '2027-01-01',
    status: 'valid'
  })
});

add('/api/v1/drivers/{id}/qualifications/{qualificationId}', 'put', 'Update qualification', {
  roles: ['fleet_admin'],
  params: [
    pathParam('id', 'Driver ID'),
    pathParam('qualificationId', 'Qualification ID')
  ],
  body: bodyRef('QualificationRequest', {
    qualification: 'Heavy Vehicle',
    validTo: '2027-01-01',
    status: 'valid'
  })
});

add('/api/v1/drivers/{id}/availability', 'get', 'Driver availability', {
  params: [pathParam('id', 'Driver ID')]
});

/* ----------------------------- Reservations ----------------------------- */

add('/api/v1/reservations', 'get', 'List reservations', {
  roles: ['dispatcher', 'fleet_admin', 'auditor']
});

add('/api/v1/reservations', 'post', 'Create reservation', {
  body: bodyRef('ReservationCreateRequest', {
    vehicleId: 'FLT-V-001',
    startTime: '2026-09-22T09:00:00',
    endTime: '2026-09-22T12:00:00',
    origin: 'University Campus',
    destination: 'Assiut Airport',
    passengers: 3,
    load: 50,
    distanceKm: 35
  })
});

add('/api/v1/reservations/my', 'get', 'My reservations', {
  params: [
    queryParam('status'),
    queryParam('from', 'string', 'Trip start lower bound'),
    queryParam('to', 'string', 'Trip end upper bound'),
    queryParam('page', 'integer', 'Page number', 1),
    queryParam('limit', 'integer', 'Page size', 20)
  ]
});

add('/api/v1/reservations/{id}', 'get', 'Reservation details', {
  params: [pathParam('id', 'Reservation ID')]
});

add('/api/v1/reservations/{id}/cancel', 'post', 'Cancel reservation', {
  params: [pathParam('id', 'Reservation ID')],
  body: bodyRef('ReservationCancelRequest', {
    reason: 'Schedule changed'
  })
});

add('/api/v1/reservations/{id}/status-history', 'get', 'Reservation status history', {
  params: [pathParam('id', 'Reservation ID')]
});

/* ----------------------------- Dispatcher ----------------------------- */

add('/api/v1/dispatcher/reservations', 'get', 'Pending/dispatcher reservations', {
  roles: ['dispatcher', 'fleet_admin'],
  params: [
    queryParam('status'),
    queryParam('page', 'integer', 'Page number', 1),
    queryParam('limit', 'integer', 'Page size', 20)
  ]
});

add('/api/v1/dispatcher/reservations/{id}', 'get', 'Reservation review', {
  roles: ['dispatcher', 'fleet_admin'],
  params: [pathParam('id', 'Reservation ID')]
});

add('/api/v1/dispatcher/reservations/{id}/approve', 'post', 'Approve and assign vehicle/driver', {
  roles: ['dispatcher', 'fleet_admin'],
  params: [pathParam('id', 'Reservation ID')],
  body: bodyRef('ReservationDecisionRequest', {
    vehicleId: 'FLT-V-001',
    driverId: 1,
    reason: 'Approved after availability check'
  })
});

add('/api/v1/dispatcher/reservations/{id}/reject', 'post', 'Reject reservation', {
  roles: ['dispatcher', 'fleet_admin'],
  params: [pathParam('id', 'Reservation ID')],
  body: bodyRef('ReservationRejectRequest', {
    reason: 'Vehicle unavailable'
  })
});

add('/api/v1/dispatcher/trips', 'get', 'Dispatcher trips', {
  roles: ['dispatcher', 'fleet_admin', 'auditor']
});

/* ----------------------------- Routes ----------------------------- */

add('/api/v1/routes/estimate', 'post', 'Estimate route', {
  body: bodyRef('RouteEstimateRequest', {
    reservationId: 'FLT-RES-0001',
    origin: { latitude: 27.18, longitude: 31.18 },
    destination: { latitude: 27.05, longitude: 31.01 }
  })
});

/* ----------------------------- Fuel ----------------------------- */

add('/api/v1/fuel/estimate', 'post', 'Estimate fuel', {
  body: bodyRef('FuelEstimateRequest', {
    reservationId: 'FLT-RES-0001',
    vehicleId: 'FLT-V-001',
    routeDistanceKm: 120,
    trafficBand: 'medium',
    acUsage: true
  })
});

add('/api/v1/fuel/estimates', 'get', 'Fuel estimate history', {
  params: [
    queryParam('page', 'integer', 'Page number', 1),
    queryParam('limit', 'integer', 'Page size', 20)
  ]
});

add('/api/v1/fuel/model', 'get', 'Active fuel model');

add('/api/v1/fuel/model/metrics', 'get', 'Fuel model metrics');

/* ----------------------------- Trips ----------------------------- */

add('/api/v1/trips/my', 'get', 'My trips');

add('/api/v1/trips/{id}', 'get', 'Trip details', {
  params: [pathParam('id', 'Trip ID')]
});

add('/api/v1/trips/{id}/assign', 'post', 'Assign vehicle and driver', {
  roles: ['dispatcher', 'fleet_admin'],
  params: [pathParam('id', 'Trip ID')],
  body: bodyRef('TripAssignRequest', {
    vehicleId: 'FLT-V-001',
    driverId: 1,
    reason: 'Dispatcher assignment'
  })
});

add('/api/v1/trips/{id}/dispatch', 'post', 'Dispatch trip', {
  roles: ['dispatcher', 'fleet_admin'],
  params: [pathParam('id', 'Trip ID')],
  body: bodyRef('TripDispatchRequest', {
    reason: 'Ready for dispatch'
  })
});

add('/api/v1/trips/{id}/start', 'post', 'Start trip', {
  roles: ['driver'],
  params: [pathParam('id', 'Trip ID')],
  body: bodyRef('TripStartRequest', {
    odometerStart: 12500,
    latitude: 27.18,
    longitude: 31.18,
    timestamp: '2026-09-22T09:00:00Z'
  })
});

add('/api/v1/trips/{id}/locations', 'post', 'Send location', {
  roles: ['driver'],
  params: [pathParam('id', 'Trip ID')],
  body: bodyRef('LocationRequest', {
    latitude: 27.18,
    longitude: 31.18,
    timestamp: '2026-09-22T09:30:00Z',
    accuracyMeters: 10,
    speedKmh: 35
  })
});

add('/api/v1/trips/{id}/locations', 'get', 'Location history', {
  params: [
    pathParam('id', 'Trip ID'),
    queryParam('from', 'string', 'Recorded-at lower bound'),
    queryParam('to', 'string', 'Recorded-at upper bound')
  ]
});

add('/api/v1/trips/{id}/location/latest', 'get', 'Latest location', {
  params: [pathParam('id', 'Trip ID')]
});

add('/api/v1/trips/{id}/complete', 'post', 'Complete trip', {
  roles: ['driver'],
  params: [pathParam('id', 'Trip ID')],
  body: bodyRef('TripCompleteRequest', {
    odometerEnd: 12545,
    actualDistanceKm: 45,
    actualFuelLiters: 5.2,
    notes: 'Trip completed normally'
  })
});

add('/api/v1/trips/{id}/fuel', 'get', 'Trip fuel', {
  params: [pathParam('id', 'Trip ID')]
});

add('/api/v1/trips/{id}/fuel', 'post', 'Add fuel', {
  roles: ['driver', 'dispatcher', 'fleet_admin'],
  params: [pathParam('id', 'Trip ID')],
  body: bodyRef('FuelTransactionRequest', {
    liters: 20,
    cost: 500,
    odometer: 12545,
    timestamp: '2026-09-22T12:00:00Z'
  })
});

add('/api/v1/trips/{id}/status-history', 'get', 'Trip status history', {
  params: [pathParam('id', 'Trip ID')]
});

/* ----------------------------- Dashboard ----------------------------- */

add('/api/v1/dashboard/requester', 'get', 'Requester dashboard');

add('/api/v1/dashboard/dispatcher', 'get', 'Dispatcher dashboard', {
  roles: ['dispatcher', 'fleet_admin']
});

add('/api/v1/dashboard/driver', 'get', 'Driver dashboard', {
  roles: ['driver']
});

add('/api/v1/dashboard/admin', 'get', 'Admin dashboard', {
  roles: ['fleet_admin']
});

add('/api/v1/dashboard/auditor', 'get', 'Auditor dashboard', {
  roles: ['auditor', 'fleet_admin']
});

/* ----------------------------- Analytics ----------------------------- */

add('/api/v1/analytics/overview', 'get', 'Overall analytics', {
  params: [
    queryParam('from', 'string', 'Optional start date'),
    queryParam('to', 'string', 'Optional end date'),
    queryParam('vehicleType'),
    queryParam('vehicleId')
  ]
});

add('/api/v1/analytics/fleet-utilization', 'get', 'Fleet utilization', {
  roles: ['dispatcher', 'fleet_admin', 'auditor']
});

add('/api/v1/analytics/booking-demand', 'get', 'Booking demand');

add('/api/v1/analytics/fuel', 'get', 'Fuel analytics');

add('/api/v1/analytics/fuel-variance', 'get', 'Fuel variance');

add('/api/v1/analytics/cost', 'get', 'Cost analytics');

add('/api/v1/analytics/maintenance', 'get', 'Maintenance analytics');

/* ----------------------------- Audit ----------------------------- */

add('/api/v1/audit-logs', 'get', 'Audit logs', {
  roles: ['auditor', 'fleet_admin'],
  params: [
    queryParam('actorId'),
    queryParam('action'),
    queryParam('entityType'),
    queryParam('entityId'),
    queryParam('from'),
    queryParam('to'),
    queryParam('page', 'integer', 'Page number', 1),
    queryParam('limit', 'integer', 'Page size', 20)
  ]
});

add('/api/v1/audit-logs/{entityType}/{entityId}', 'get', 'Entity audit history', {
  roles: ['auditor', 'fleet_admin', 'dispatcher'],
  params: [
    pathParam('entityType', 'Entity type'),
    pathParam('entityId', 'Entity ID')
  ]
});

/* ----------------------------- Notifications ----------------------------- */

add('/api/v1/notifications', 'get', 'Notifications');

add('/api/v1/notifications/{notificationId}/read', 'patch', 'Mark notification read', {
  params: [pathParam('notificationId', 'Notification ID')]
});

add('/api/v1/notifications/read-all', 'post', 'Mark all notifications read');

/* ----------------------------- Maintenance ----------------------------- */

add('/api/v1/vehicles/{id}/maintenance', 'get', 'Maintenance records', {
  params: [pathParam('id', 'Vehicle ID')]
});

add('/api/v1/vehicles/{id}/maintenance', 'post', 'Create maintenance', {
  roles: ['fleet_admin', 'dispatcher'],
  params: [pathParam('id', 'Vehicle ID')],
  body: bodyRef('MaintenanceRequest', {
    maintenanceType: 'Oil Change',
    description: 'Routine engine oil change',
    startAt: '2026-09-22T08:00:00Z',
    endAt: '2026-09-22T10:00:00Z',
    status: 'open'
  })
});

add('/api/v1/maintenance/{maintenanceId}', 'put', 'Update maintenance', {
  roles: ['fleet_admin', 'dispatcher'],
  params: [pathParam('maintenanceId', 'Maintenance ID')],
  body: bodyRef('MaintenanceRequest', {
    description: 'Routine engine oil change',
    status: 'open'
  })
});

add('/api/v1/maintenance/{maintenanceId}/complete', 'post', 'Complete maintenance', {
  roles: ['fleet_admin', 'dispatcher'],
  params: [pathParam('maintenanceId', 'Maintenance ID')]
});

add('/api/v1/maintenance/{id}', 'get', 'Get maintenance record', {
  params: [pathParam('id', 'Maintenance ID')]
});

/* ----------------------------- Reports ----------------------------- */

for (const type of ['fleet', 'bookings', 'fuel', 'maintenance']) {
  add(`/api/v1/reports/${type}`, 'get', `${type[0].toUpperCase()}${type.slice(1)} report`, {
    roles: ['dispatcher', 'fleet_admin', 'auditor'],
    params: [
      {
        name: 'format',
        in: 'query',
        required: false,
        description: 'Response format',
        schema: {
          type: 'string',
          enum: ['json', 'csv', 'xlsx'],
          default: 'json'
        },
        example: 'json'
      }
    ]
  });
}

/* ----------------------------- OpenAPI document ----------------------------- */

const publicBaseUrl =
  process.env.PUBLIC_BASE_URL ||
  'https://raymond-arizona-oxford-edit.trycloudflare.com';

module.exports = {
  openapi: '3.0.3',

  info: {
    title: 'University Fleet Management API',
    version: '2.0.0',
    description:
      'University Fleet Management backend API. Swagger documentation is aligned with the implemented Express routes, authentication, request bodies, parameters and roles.'
  },

  servers: [
    {
      url: 'https://university-fleet-backend.vercel.app',
      description: 'Vercel production server'
    },
    {
      url: 'http://localhost:3000',
      description: 'Local development server'
    },
    {
      url: publicBaseUrl,
      description: 'Cloudflare public tunnel'
    }
  ],

  tags: [
    { name: 'auth' },
    { name: 'users' },
    { name: 'vehicles' },
    { name: 'reservations' },
    { name: 'dispatcher' },
    { name: 'drivers' },
    { name: 'routes' },
    { name: 'fuel' },
    { name: 'trips' },
    { name: 'dashboard' },
    { name: 'analytics' },
    { name: 'audit-logs' },
    { name: 'notifications' },
    { name: 'maintenance' },
    { name: 'reports' }
  ],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter only the JWT access token. Swagger adds the Bearer prefix.'
      }
    },
    schemas
  },

  paths
};
