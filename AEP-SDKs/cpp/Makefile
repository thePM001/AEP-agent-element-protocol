CXX ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Iinclude
SRC = src/lattice_client.cpp
LIB = libaep_lattice_client.a

.PHONY: all test clean

all: $(LIB)

$(LIB): $(SRC)
	$(CXX) $(CXXFLAGS) -c $(SRC) -o src/lattice_client.o
	ar rcs $(LIB) src/lattice_client.o

test: all
	$(CXX) $(CXXFLAGS) -o smoke tests/smoke.cpp $(LIB) -lstdc++fs
	./smoke || true

clean:
	rm -f $(LIB) src/lattice_client.o smoke